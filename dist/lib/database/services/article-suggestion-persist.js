"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.persistAndLinkV2Suggestions = persistAndLinkV2Suggestions;
exports.updateClusterMemberships = updateClusterMemberships;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _articleSuggestionStatus = require("../article-suggestion-status");
var _factService = require("./fact-service");
var _logger = _interopRequireDefault(require("../../logger"));
var _articleSuggestionMappers = require("./article-suggestion-mappers");
var _articleSuggestionReads = require("./article-suggestion-reads");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Article Suggestion Service: persisting server suggestions.

const articleSuggestionsCol = _index.default.get('article_suggestions');
const articleSuggestionFactsCol = _index.default.get('article_suggestion_facts');

/** A reading score is a finite number (0 is valid); anything else is absent. */
function validScore(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Persona-v3 per-article metadata (supplied by feed-sync from the
 * `articleIdsForPersona` response, inverted per article). Present ⇒ the new
 * persona path: facts link via `topics.fact_id`, and matched_topics_json /
 * stable_cluster_id / headline_scope are persisted. Absent ⇒ the legacy
 * fallback path (metadata.topics fact-linking).
 */

/**
 * [Flow v2 + Persona v3] Persist articles returned by the stateless hydration
 * query. WMDB row id == articleId. When `personaMeta` is supplied (persona-v3
 * path), facts link via `topics.fact_id` and the persona scorer-input columns
 * (geo/entities/event_type/category/max_cluster_size/matched_topics/
 * stable_cluster_id/headline_scope) are persisted. Without it (fallback path),
 * facts link via fact metadata topic texts. Hydration metadata columns are
 * ALWAYS persisted from the row when the server sent them (nullable).
 */
async function persistAndLinkV2Suggestions(fetched, articleToTopicTexts, personaMeta) {
  if (fetched.length === 0) return {
    insertedCount: 0,
    linkedCount: 0
  };

  // Dedupe by article id BEFORE anything else. The hydration query returns one
  // row per (article, matched topic), so an article matching two topics — or
  // sitting in two clusters — arrives twice in `fetched`. Both copies then
  // missed the existing-row check identically and the SAME id was
  // prepareCreate'd twice into one batch, which SQLite rejects wholesale:
  // "sqlite error 1555 (UNIQUE constraint failed: article_suggestions.id)"
  // (MERA-APP-6K). The batch is atomic, so one duplicated article discarded the
  // entire sync's inserts, not just its own row.
  //
  // First copy wins: the per-article metadata below is derived from
  // `personaMeta` maps keyed by article id, which are identical for every copy,
  // so the copies are interchangeable.
  //
  // The read below happens outside `database.write`, so two CONCURRENT callers
  // (feed-sync racing a manual refresh) can both read "absent". The writer
  // therefore re-checks which of those ids are still absent before it creates
  // anything, so the loser skips what the winner inserted and still inserts its
  // own.
  const deduped = [];
  const seenIds = new Set();
  for (const a of fetched) {
    if (seenIds.has(a._id)) continue;
    seenIds.add(a._id);
    deduped.push(a);
  }
  const existingRows = await articleSuggestionsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(deduped.map(a => a._id)))).fetch();
  const existingById = new Map(existingRows.map(r => [r.id, r]));
  const toInsert = deduped.filter(a => !existingById.has(a._id));

  // Updates to already-persisted rows: a changed cluster membership and/or the
  // Matched-topics backfill. Each field is optional and applied only when
  // set, so an unchanged cluster is left alone while topics are healed and vice
  // versa.
  const existingUpdates = [];
  for (const a of deduped) {
    const row = existingById.get(a._id);
    if (!row) continue;
    const update = {
      row
    };
    let hasUpdate = false;
    const nextClusterJson = changedClusterJson(row, a.clusters);
    if (nextClusterJson !== undefined) {
      update.nextClusterJson = nextClusterJson;
      hasUpdate = true;
    }

    // Heal rows persisted during the topics-empty window. The legacy
    // fallback persisted matched_topics_json = null, so section ownership
    // orphaned every article to "Also for you" (sticky, since a re-sync only
    // ever touched clusterMembershipsJson). When we now have persona matched
    // topics for this article and the stored value is still null/empty, backfill
    // it — never overwriting a non-null value.
    if (personaMeta && (0, _articleSuggestionMappers.isMatchedTopicsJsonEmpty)(row.matchedTopicsJson)) {
      const matched = personaMeta.matchedTopics.get(a._id) ?? [];
      if (matched.length > 0) {
        update.nextMatchedTopicsJson = (0, _articleSuggestionMappers.buildMatchedTopicsJson)(matched);
        hasUpdate = true;
      }
    }

    // Write-once: fill a null story_key from the incoming article, never replace one.
    if (row.storyKey == null && a.story_key) {
      update.nextStoryKey = a.story_key;
      hasUpdate = true;
    }

    // An absent or invalid incoming score never wipes a stored one.
    const incomingScore = validScore(a.readingScore);
    if (incomingScore !== null && incomingScore !== row.readingScore) {
      update.nextReadingScore = incomingScore;
      hasUpdate = true;
    }
    if (hasUpdate) existingUpdates.push(update);
  }
  if (toInsert.length === 0 && existingUpdates.length === 0) {
    return {
      insertedCount: 0,
      linkedCount: 0
    };
  }

  // --- Fact resolution: persona path uses topics.fact_id; fallback uses texts.
  let factsByTopicText = null;
  let factByTopicId = null;
  if (personaMeta) {
    const allTopicIds = Array.from(new Set(toInsert.flatMap(a => (personaMeta.matchedTopics.get(a._id) ?? []).map(m => m.topicId).filter(id => !!id))));
    factByTopicId = await (0, _articleSuggestionReads.resolveFactsByTopicIds)(allTopicIds);
  } else {
    const allTopicTexts = Array.from(new Set(toInsert.flatMap(a => articleToTopicTexts.get(a._id) ?? [])));
    factsByTopicText = await resolveFactsByTopicTexts(allTopicTexts);
  }
  let insertedCount = 0;
  let linkedCount = 0;
  await _index.default.write(async () => {
    const ops = [];
    const now = new Date();

    // Atomic with the creates below: a concurrent writer that ran first has
    // committed its rows by now, and a second create of the same id would reject
    // this whole batch (the loser's own new article included).
    const takenNow = new Set((await articleSuggestionsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(toInsert.map(a => a._id)))).fetch()).map(r => r.id));

    // A prune can destroy a planned row between the read above and this writer;
    // preparing an update on it would throw and fail the whole batch.
    const stillThere = new Set((await articleSuggestionsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(existingUpdates.map(u => u.row.id)))).fetch()).map(r => r.id));
    for (const {
      row,
      nextClusterJson,
      nextMatchedTopicsJson,
      nextStoryKey,
      nextReadingScore
    } of existingUpdates) {
      if (!stillThere.has(row.id)) continue;
      ops.push(row.prepareUpdate(r => {
        if (nextClusterJson !== undefined) r.clusterMembershipsJson = nextClusterJson;
        if (nextMatchedTopicsJson !== undefined) r.matchedTopicsJson = nextMatchedTopicsJson;
        if (nextStoryKey !== undefined) r.storyKey = nextStoryKey;
        if (nextReadingScore !== undefined) r.readingScore = nextReadingScore;
      }));
    }
    for (const a of toInsert) {
      if (takenNow.has(a._id)) continue;
      const matched = personaMeta?.matchedTopics.get(a._id) ?? [];
      // Topic texts: persona path derives them from matchMeta entries; fallback
      // uses the caller-supplied text map. Kept for matched_topic_texts_json
      // (getArticleSuggestionsByTopicTexts / pruneOrphanedSuggestions readers).
      const topicTexts = personaMeta ? Array.from(new Set(matched.map(m => m.text).filter(t => t && t.length > 0))) : articleToTopicTexts.get(a._id) ?? [];
      const scope = personaMeta?.headlineScope?.get(a._id) ?? null;
      // Only meaningful alongside a COUNTRY scope; feed-sync already writes the
      // map under the same first-writer-wins guard as `headlineScope`, so the
      // two can never describe different scopes for the same article.
      const scopeCountry = scope === 'COUNTRY' ? personaMeta?.headlineCountryCode?.get(a._id) ?? null : null;
      const stableId = (0, _articleSuggestionMappers.pickStableClusterId)(a, personaMeta?.stableClusterId?.get(a._id));
      const prepared = articleSuggestionsCol.prepareCreate(r => {
        r._raw.id = a._id;
        r.articleId = a._id;
        r.clusterMembershipsJson = (0, _articleSuggestionMappers.canonicalClusterMembershipsJson)((0, _articleSuggestionMappers.toClusterMemberships)(a.clusters));
        r.relevance = 0;
        r.reason = '';
        r.status = _articleSuggestionStatus.ArticleSuggestionStatus.Unscored;
        r.countryCode = a.country_code ?? null;
        r.languageCode = a.language_code ?? null;
        r.publicationName = a.publication_name ?? null;
        if (a.title_en && a.title_en === a.title && a.language_code && a.language_code !== 'en') {
          _logger.default.warn('[ArticleSuggestionService] title_en matches original-language title', {
            articleId: a._id,
            languageCode: a.language_code
          });
        }
        r.titleEn = a.title_en ?? null;
        r.titleOriginal = a.title ?? null;
        r.descriptionEn = a.description_en ?? null;
        r.articleUrl = a.article_url ?? null;
        r.imageUrl = a.image_url ?? null;
        r.matchedTopicTextsJson = JSON.stringify(topicTexts);
        // ── Persona v3 scorer-input columns (hydration metadata always; the
        //    persona-specific ones only on the persona path) ──
        r.geoTagsJson = a.geo_tags && a.geo_tags.length > 0 ? JSON.stringify(a.geo_tags.map(g => ({
          city: g.city ?? undefined,
          region: g.region ?? undefined,
          countryCode: g.countryCode
        }))) : null;
        r.entitiesJson = a.entities && a.entities.length > 0 ? JSON.stringify(a.entities) : null;
        r.eventType = a.event_type ?? null;
        r.category = a.category ?? null;
        r.maxClusterSize = a.maxClusterSize ?? null;
        r.stableClusterId = stableId;
        r.storyKey = a.story_key ?? null;
        r.readingScore = validScore(a.readingScore);
        r.headlineScope = scope;
        r.headlineCountryCode = scopeCountry;
        r.matchedTopicsJson = personaMeta ? (0, _articleSuggestionMappers.buildMatchedTopicsJson)(matched) : null;
        r.computedScore = null;
        r.rawScore = null;
        r.scoreComponentsJson = null;
        r.createdAt = now;
        r.firstPubDate = (0, _articleSuggestionMappers.parseDate)(a.pubDate) ?? now;
      });
      ops.push(prepared);
      insertedCount++;

      // --- Fact links ---
      const linkedFactIds = new Set();
      if (personaMeta && factByTopicId) {
        for (const m of matched) {
          if (!m.topicId) continue; // synthetic headline entry → no fact
          const factId = factByTopicId.get(m.topicId);
          if (factId) linkedFactIds.add(factId);
        }
      } else if (factsByTopicText) {
        for (const topicText of topicTexts) {
          for (const factId of factsByTopicText.get(topicText) ?? []) {
            linkedFactIds.add(factId);
          }
        }
      }
      for (const factId of linkedFactIds) {
        ops.push(articleSuggestionFactsCol.prepareCreate(r => {
          r.articleSuggestionId = prepared.id;
          r.factId = factId;
          r.createdAt = now;
        }));
        linkedCount++;
      }
    }
    if (ops.length > 0) await _index.default.batch(ops);
  });
  return {
    insertedCount,
    linkedCount
  };
}

/** The canonical memberships JSON to write, or undefined when the row already holds it (in any order). */
function changedClusterJson(row, clusters) {
  const next = (0, _articleSuggestionMappers.canonicalClusterMembershipsJson)((0, _articleSuggestionMappers.toClusterMemberships)(clusters));
  const current = (0, _articleSuggestionMappers.canonicalClusterMembershipsJson)((0, _articleSuggestionMappers.parseClusterMemberships)(row.clusterMembershipsJson));
  return next === current ? undefined : next;
}

/**
 * The hourly membership refresh: write each answered article's memberships onto
 * its row. UPDATE ONLY: an id with no row is skipped, never inserted. An article the
 * answer leaves out keeps its value; `clusters: []` clears it. Rows are read inside
 * the writer, so a prune that ran first is respected. Returns how many rows changed.
 */
async function updateClusterMemberships(answer) {
  if (answer.length === 0) return 0;
  const byId = new Map(answer.map(a => [a.articleId, a.clusters]));
  // Unchanged rows cost no write: the common answer after the first refresh.
  const planned = (await articleSuggestionsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf([...byId.keys()]))).fetch()).filter(row => byId.has(row.id) && changedClusterJson(row, byId.get(row.id)) !== undefined);
  if (planned.length === 0) return 0;
  return _index.default.write(async () => {
    const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(planned.map(r => r.id)))).fetch();
    const ops = rows.flatMap(row => {
      // An id the answer left out is "no info", never a clear.
      const next = byId.has(row.id) ? changedClusterJson(row, byId.get(row.id)) : undefined;
      if (next === undefined) return [];
      // The indexed column is what the subscribed-sibling query reads. Fill it when empty (rows
      // hydrated before clustering); a value already there, persona-meta included, stays.
      const scid = byId.get(row.id)?.find(c => c.stableClusterId)?.stableClusterId ?? null;
      return [row.prepareUpdate(r => {
        r.clusterMembershipsJson = next;
        if (!r.stableClusterId && scid) r.stableClusterId = scid;
      })];
    });
    if (ops.length > 0) await _index.default.batch(ops);
    return ops.length;
  });
}
async function resolveFactsByTopicTexts(topicTexts) {
  const result = new Map();
  if (topicTexts.length === 0) return result;
  const topicSet = new Set(topicTexts);
  const facts = await (0, _factService.getFacts)();
  for (const fact of facts) {
    for (const topic of fact.metadata?.topics ?? []) {
      if (topicSet.has(topic)) {
        const bucket = result.get(topic) ?? [];
        bucket.push(fact.id);
        result.set(topic, bucket);
      }
    }
  }
  return result;
}