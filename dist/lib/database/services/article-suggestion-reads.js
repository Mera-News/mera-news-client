"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.countUnscoredSuggestions = countUnscoredSuggestions;
exports.findSuggestionByServerId = findSuggestionByServerId;
exports.getArticleSuggestionsByTopicTexts = getArticleSuggestionsByTopicTexts;
exports.getCullableLowHeadlineIds = getCullableLowHeadlineIds;
exports.getDistinctSuggestionPublicationNames = getDistinctSuggestionPublicationNames;
exports.getFactWeightById = getFactWeightById;
exports.getGroupingRowsByIds = getGroupingRowsByIds;
exports.getLocalSuggestionServerIds = getLocalSuggestionServerIds;
exports.getOldestUnscoredCreatedAt = getOldestUnscoredCreatedAt;
exports.getReasonedSuggestionIdForArticle = getReasonedSuggestionIdForArticle;
exports.getScoredDonorRows = getScoredDonorRows;
exports.getScoredSuggestionsWithoutReasons = getScoredSuggestionsWithoutReasons;
exports.getStageRowsByIds = getStageRowsByIds;
exports.getStageRowsForScreening = getStageRowsForScreening;
exports.getSuggestionByArticleId = getSuggestionByArticleId;
exports.getSuggestionByServerId = getSuggestionByServerId;
exports.getSuggestionFeedbackContext = getSuggestionFeedbackContext;
exports.getUnscoredGroupingRows = getUnscoredGroupingRows;
exports.getUnscoredSuggestionsWithFacts = getUnscoredSuggestionsWithFacts;
exports.loadSuggestions = loadSuggestions;
exports.resolveFactsByNormalizedTopicTexts = resolveFactsByNormalizedTopicTexts;
exports.resolveFactsByTopicIds = resolveFactsByTopicIds;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _articleSuggestionStatus = require("../article-suggestion-status");
var _importanceFilter = require("../../feed-ordering/importance-filter");
var _normalizeKey = require("../../algorithms/normalize-key");
var _factService = require("./fact-service");
var _factPlaces = require("../../news-harness/persona-management/fact-places");
var _logger = _interopRequireDefault(require("../../logger"));
var _articleSuggestionMappers = require("./article-suggestion-mappers");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Article Suggestion Service — hydrates the ForYou feed from local cache.
// The local cache holds a single parent (article_suggestions) and a single
// child (article_suggestion_facts) — related siblings are fetched fresh from
// the server when the detail screen opens (relatedArticles).

// The ONE LOW-band top-headline cull predicate. Safe to import from a database
// service: `importance-filter` → `priority-order` is a two-module, PURE, RN-free
// leaf (no DB / expo / react-native imports and no edge back into this module),
// so it closes no cycle and drags nothing native into a harness-adjacent graph.

const articleSuggestionsCol = _index.default.get('article_suggestions');
const articleSuggestionFactsCol = _index.default.get('article_suggestion_facts');
const factsCol = _index.default.get('facts');
const topicsCol = _index.default.get('topics');

/** factId → fact-level weight multiplier (null/undefined ⇒ 1.0). Used by the
 *  orchestrators to compute topic effectiveWeight = topic.weight × factWeight. */
async function getFactWeightById() {
  const facts = await factsCol.query().fetch();
  const m = new Map();
  for (const f of facts) m.set(f.id, f.weight ?? 1);
  return m;
}

/**
 * Resolve the owning fact for each topic id via the persona-v3 `topics` table
 * (topics.fact_id), replacing the old `resolveFactsByTopicTexts` scan of
 * fact.metadata.topics for the persona-v3 path. Returns topicId → factId for
 * topics that have an owning fact (headline/global topics with no fact_id are
 * simply absent → no fact link, which the reason path handles via the headline
 * label).
 */
async function resolveFactsByTopicIds(topicIds) {
  const result = new Map();
  if (topicIds.length === 0) return result;
  const rows = await topicsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(topicIds))).fetch();
  for (const t of rows) {
    if (t.factId) result.set(t.id, t.factId);
  }
  return result;
}

/**
 * normalized topic text → distinct fact ids owning an active, live, positive-weight topic with
 * that text. Retrieval merges same-text topics and keeps the heaviest, so a row can be matched
 * under a topic that owns no fact while a fact topic with the same words exists.
 */
async function resolveFactsByNormalizedTopicTexts(texts) {
  const result = new Map();
  if (texts.length === 0) return result;
  const rows = await topicsCol.query(_watermelondb.Q.where('normalized_text', _watermelondb.Q.oneOf(texts)), _watermelondb.Q.where('status', 'active'), _watermelondb.Q.where('pending_delete_at', null), _watermelondb.Q.where('fact_id', _watermelondb.Q.notEq(null)), _watermelondb.Q.where('weight', _watermelondb.Q.gt(0))).fetch();
  for (const t of rows) {
    if (!t.factId) continue;
    const ids = result.get(t.normalizedText) ?? [];
    if (!ids.includes(t.factId)) ids.push(t.factId);
    result.set(t.normalizedText, ids);
  }
  return result;
}

/**
 * Returns the ids of every article_suggestion row on-device. Since the WMDB
 * row id equals the server `_id`, these ids are directly diffable against
 * the server's id set.
 */
async function getLocalSuggestionServerIds() {
  const rows = await articleSuggestionsCol.query().fetch();
  return rows.map(r => r.id);
}
async function loadSuggestions() {
  // Intentionally uncapped: article_suggestions is bounded by the server's 48h
  // suggestion TTL, not by a query limit here.
  const rows = await articleSuggestionsCol.query().fetch();
  if (rows.length === 0) return [];
  const factIdsBySuggestion = await loadFactIdsBySuggestion(rows.map(r => r.id));
  return rows.map(row => (0, _articleSuggestionMappers.toForYouSuggestion)(row, factIdsBySuggestion.get(row.id) ?? []));
}

/** Batch-load the linked fact ids for a set of suggestion ids →
 *  suggestionId → factId[] (empty for orphan/headline rows). */
async function loadFactIdsBySuggestion(ids) {
  const map = new Map();
  const links = await articleSuggestionFactsCol.query(_watermelondb.Q.where('article_suggestion_id', _watermelondb.Q.oneOf(ids))).fetch();
  for (const link of links) {
    const bucket = map.get(link.articleSuggestionId) ?? [];
    bucket.push(link.factId);
    map.set(link.articleSuggestionId, bucket);
  }
  return map;
}

// Canonical home is now lib/news-harness/core/types.ts; re-exported here so
// importers of ScoringCandidate from this service keep working unchanged.

/** A matched fact for scoring. `places` (names) reaches only the cloud prompts, through
 *  relatedFactLine; Kev and the on-device note read `statement` alone. */
function relatedFactOf(fact) {
  const places = (0, _factPlaces.describeFactPlaces)({
    statement: fact.statement,
    metadata: fact.metadata
  });
  return places ? {
    id: fact.id,
    statement: fact.statement,
    places
  } : {
    id: fact.id,
    statement: fact.statement
  };
}

/** Unscored rows, newest published first: what scoring reads next, so the day
 *  after a reading hold goes to today's news. Never gated by the hold (the
 *  dispatch site is); bookkeeping callers need every row. */
async function getUnscoredSuggestionsWithFacts(limit) {
  const newestFirst = [_watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.Unscored), _watermelondb.Q.sortBy('first_pub_date', _watermelondb.Q.desc)];
  const rows = await (limit !== undefined ? articleSuggestionsCol.query(...newestFirst, _watermelondb.Q.take(limit)).fetch() : articleSuggestionsCol.query(...newestFirst).fetch());
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const links = await articleSuggestionFactsCol.query(_watermelondb.Q.where('article_suggestion_id', _watermelondb.Q.oneOf(ids))).fetch();
  const factIds = [...new Set(links.map(l => l.factId))];
  const facts = factIds.length ? await factsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(factIds))).fetch() : [];
  const factById = new Map(facts.map(f => [f.id, f]));
  const factsBySuggestionId = new Map();
  for (const link of links) {
    const fact = factById.get(link.factId);
    if (!fact) continue;
    const bucket = factsBySuggestionId.get(link.articleSuggestionId) ?? [];
    bucket.push(relatedFactOf(fact));
    factsBySuggestionId.set(link.articleSuggestionId, bucket);
  }
  return rows.map(row => ({
    id: row.id,
    titleEn: row.titleEn,
    descriptionEn: row.descriptionEn,
    countryCode: row.countryCode,
    publicationName: row.publicationName,
    languageCode: row.languageCode,
    userTopicIds: (0, _articleSuggestionMappers.parseTopicIds)(row.matchedTopicTextsJson),
    relatedFacts: factsBySuggestionId.get(row.id) ?? [],
    meta: (0, _articleSuggestionMappers.toStageRow)(row)
  }));
}
async function countUnscoredSuggestions() {
  return articleSuggestionsCol.query(_watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.Unscored)).fetchCount();
}

/**
 * Returns the created-at timestamp (ms) of the oldest still-unscored row, or
 * null when no unscored rows exist. Backs the scoring-pipeline min-run-size
 * gate's 30-minute escape (a slow trickle shouldn't hide news indefinitely).
 */
async function getOldestUnscoredCreatedAt() {
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.Unscored), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.asc), _watermelondb.Q.take(1)).fetch();
  return rows[0]?.createdAt.getTime() ?? null;
}
async function getScoredSuggestionsWithoutReasons(limit) {
  // Re-attempt rows that are scored but still awaiting a reason. A failed reason
  // attempt leaves the row in reason_pending, so this query re-fetches it.
  //
  // The `reason_pending`-ONLY predicate (rather than "any non-unscored status
  // without a reason") is what keeps terminally `excluded` rows out of
  // retryMissingReasons / enqueueOrphanedReasons: an excluded row has no reason
  // and will never get one, so a status-notEq(unscored) predicate here would
  // re-spend LLM calls on it forever. Do not widen this query.
  const rows = await (limit !== undefined ? articleSuggestionsCol.query(_watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.ReasonPending), _watermelondb.Q.take(limit)).fetch() : articleSuggestionsCol.query(_watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.ReasonPending)).fetch());
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const links = await articleSuggestionFactsCol.query(_watermelondb.Q.where('article_suggestion_id', _watermelondb.Q.oneOf(ids))).fetch();
  const factIds = [...new Set(links.map(l => l.factId))];
  const facts = factIds.length ? await factsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(factIds))).fetch() : [];
  const factById = new Map(facts.map(f => [f.id, f]));
  const factsBySuggestionId = new Map();
  for (const link of links) {
    const fact = factById.get(link.factId);
    if (!fact) continue;
    const bucket = factsBySuggestionId.get(link.articleSuggestionId) ?? [];
    bucket.push(relatedFactOf(fact));
    factsBySuggestionId.set(link.articleSuggestionId, bucket);
  }
  return rows.map(row => ({
    id: row.id,
    titleEn: row.titleEn,
    descriptionEn: row.descriptionEn,
    countryCode: row.countryCode,
    publicationName: row.publicationName,
    languageCode: row.languageCode,
    userTopicIds: (0, _articleSuggestionMappers.parseTopicIds)(row.matchedTopicTextsJson),
    relatedFacts: factsBySuggestionId.get(row.id) ?? [],
    relevance: row.relevance,
    meta: (0, _articleSuggestionMappers.toStageRow)(row)
  }));
}

/** Grouping rows for specific suggestion ids (skip-gate candidates). */
async function getGroupingRowsByIds(ids) {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(ids))).fetch();
  // The unit-test fake DB layer doesn't evaluate Q.where predicates (see
  // mockDatabase.ts), so re-assert the id filter in memory too.
  return rows.filter(r => idSet.has(r.id)).map(_articleSuggestionMappers.toGroupingRow);
}

/** All currently-unscored rows as grouping rows, newest published first: the
 *  gate keeps this order into `enqueueIds`, so it is cloud dispatch order. */
async function getUnscoredGroupingRows() {
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.Unscored), _watermelondb.Q.sortBy('first_pub_date', _watermelondb.Q.desc)).fetch();
  return rows.filter(r => r.status === _articleSuggestionStatus.ArticleSuggestionStatus.Unscored).map(_articleSuggestionMappers.toGroupingRow);
}

/**
 * Score donors for sibling propagation: status not Unscored, Excluded or
 * AlreadyRead, a verdict (relevance > 0 OR scored_at set), AND
 * (scored_at >= sinceMs OR created_at >= sinceMs). The verdict clause drops the
 * verdict-less zeros written by `batchMarkAsScoredByIds` (relevance 0, scored_at
 * null), not a REAL zero verdict: a story's representative scored 0 donates, so
 * its siblings are not re-elected and re-scored every sync.
 *
 * BUG FIX (was `created_at >= sinceMs` only): prod logs showed
 * `propagated 0, held back N` every cycle — a row scored minutes ago but
 * created before the 48h lookback window never qualified as a donor, so no
 * group ever had one. The two clauses now cover both cases a donor can arise
 * from:
 *   - `scored_at >= sinceMs`  — the fix. A row scored recently is a fresh,
 *     trustworthy signal regardless of how old the underlying article is.
 *   - `created_at >= sinceMs` — kept for rows that themselves inherited a
 *     score via propagation (`batchPropagateScores`), which may leave
 *     `scored_at` null (see that function's status handling) while still
 *     carrying a copied relevance + reason. These were eligible donors before
 *     this fix and must stay eligible — the `OR` makes the change strictly
 *     additive: no row that qualified before now fails to qualify.
 */
async function getScoredDonorRows(sinceMs) {
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('status', _watermelondb.Q.notEq(_articleSuggestionStatus.ArticleSuggestionStatus.Unscored)),
  // A `reason_skipped` row is NEVER a donor. It carries a real, renderable
  // relevance and NO reason by design, so donating it would hand every
  // same-story sibling a renderable score with a blank note — and, since a
  // reason-less recipient lands in `reason_pending`, re-spend the very LLM
  // call the gate skipped, once per sibling. `pickDonor` prefers a donor
  // that HAS a reason, but that is a preference: a group whose only donor is
  // gated would still propagate. This is the guarantee.
  _watermelondb.Q.where('status', _watermelondb.Q.notEq(_articleSuggestionStatus.ArticleSuggestionStatus.ReasonSkipped)), _watermelondb.Q.where('status', _watermelondb.Q.notEq(_articleSuggestionStatus.ArticleSuggestionStatus.Excluded)), _watermelondb.Q.where('status', _watermelondb.Q.notEq(_articleSuggestionStatus.ArticleSuggestionStatus.AlreadyRead)), _watermelondb.Q.or(_watermelondb.Q.where('relevance', _watermelondb.Q.gt(0)), _watermelondb.Q.where('scored_at', _watermelondb.Q.notEq(null))), _watermelondb.Q.or(_watermelondb.Q.where('scored_at', _watermelondb.Q.gte(sinceMs)), _watermelondb.Q.where('created_at', _watermelondb.Q.gte(sinceMs)))).fetch();
  // Same defensive re-filter as above — the fake query() ignores Q.where.
  return rows.filter(r => r.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Unscored && r.status !== _articleSuggestionStatus.ArticleSuggestionStatus.ReasonSkipped && r.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Excluded && r.status !== _articleSuggestionStatus.ArticleSuggestionStatus.AlreadyRead && (r.relevance > 0 || r.scoredAt != null) && (typeof r.scoredAt === 'number' && r.scoredAt >= sinceMs || r.createdAt.getTime() >= sinceMs)).map(_articleSuggestionMappers.toGroupingRow);
}

/**
 * Stage rows for the retroactive hard-filter sweep. `excluded: false` (default)
 * returns every row a hard filter could still newly kill; `excluded: true`
 * returns the already-excluded rows the un-exclude sweep re-screens.
 *
 * Deliberately does NOT load `article_suggestion_facts`: hard screening reads
 * only the ScoredCandidateInput fields, and the fact links exist purely for the
 * legacy backstop payload.
 */
async function getStageRowsForScreening(opts = {}) {
  const wantExcluded = opts.excluded === true;
  const rows = await articleSuggestionsCol.query(wantExcluded ? _watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.Excluded) : _watermelondb.Q.where('status', _watermelondb.Q.notEq(_articleSuggestionStatus.ArticleSuggestionStatus.Excluded))).fetch();
  // Defensive re-filter — the unit-test fake DB layer ignores Q.where.
  return rows.filter(r => r.status === _articleSuggestionStatus.ArticleSuggestionStatus.Excluded === wantExcluded).map(_articleSuggestionMappers.toStageRow);
}

/**
 * Stage rows for a SCOPED hard-filter screen: exactly these ids, minus the ones
 * already terminal `excluded` (re-screening them would be a no-op). This is the
 * cheap counterpart to `getStageRowsForScreening` — used by the propagation
 * reconcile, which knows precisely which rows just inherited a score and must
 * not pay for a full-table scan on every sync chunk.
 */
async function getStageRowsByIds(ids) {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(ids))).fetch();
  // The unit-test fake DB layer doesn't evaluate Q.where predicates (see
  // mockDatabase.ts), so re-assert the id filter in memory too — same defensive
  // shape as getGroupingRowsByIds.
  return rows.filter(r => idSet.has(r.id) && r.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Excluded).map(_articleSuggestionMappers.toStageRow);
}

/**
 * The CONVERGENCE half of the LOW-band top-headline cull: the ids of stored
 * headline rows (`headline_scope` set) that carry a scored relevance below the
 * MEDIUM band and are still renderable. Feed to `batchMarkExcluded`.
 *
 * The persist-time culls in the scoring paths are the primary gate; this exists
 * because two classes of row never pass through them:
 *   1. BACKFILL — rows persisted before the cull shipped are already on device
 *      and live out the full 48h TTL.
 *   2. PROPAGATION — `propagateToUnscoredSiblings` copies a donor's relevance
 *      onto a headline sibling and writes it terminal `complete` directly,
 *      bypassing the persist-time cull entirely.
 *
 * Scored statuses only: `unscored` has no verdict to judge yet, and `excluded`
 * is already terminal (re-marking it would be a pointless write).
 */
async function getCullableLowHeadlineIds() {
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('headline_scope', _watermelondb.Q.notEq(null))).fetch();
  // Defensive re-filter — the unit-test fake DB layer ignores Q.where (see
  // mockDatabase.ts), same shape as getStageRowsForScreening.
  return rows.filter(r => r.headlineScope != null && (r.status === _articleSuggestionStatus.ArticleSuggestionStatus.Complete || r.status === _articleSuggestionStatus.ArticleSuggestionStatus.ReasonPending) && (0, _importanceFilter.isCulledHeadlineRelevance)(r.relevance)).map(r => r.id);
}

/**
 * Tap-time lookup: articleId → the server id of the newest suggestion for that
 * article that has a readable reason, or null.
 *
 * Deliberately the NARROWEST query that answers the question — one indexed
 * `article_id` hit, no fact joins, no topic parsing, no `toForYouSuggestion`
 * mapping (contrast `getSuggestionFeedbackContext`, which does all four). This
 * runs on every article tap on four surfaces, so it must stay a single index
 * probe over ~1 row.
 *
 * The Q predicates are mirrored by the JS filter below: the SQL narrows for
 * real, the JS makes the result independent of the query engine (and keeps the
 * predicate-ignoring test double honest).
 */
async function getReasonedSuggestionIdForArticle(articleId) {
  if (!articleId) return null;
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('article_id', articleId), _watermelondb.Q.where('status', _watermelondb.Q.notEq(_articleSuggestionStatus.ArticleSuggestionStatus.Excluded)), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc)).fetch();
  // Newest-first; take the newest row that actually has a reason rather than
  // the newest row outright — a re-synced duplicate can land reason-less
  // alongside an older, fully-reasoned sibling.
  const hit = rows.find(r => r.articleId === articleId && (0, _articleSuggestionMappers.hasReadableReason)(r));
  // The WatermelonDB `id` IS the server ArticleSuggestion `_id` (see the model
  // docstring) — that, NOT `articleId`, is what suggestion-detail resolves.
  return hit?.id ?? null;
}

/**
 * Find the newest local suggestion for an ARTICLE id (returns null if none).
 *
 * The retention path's lookup: a followed story is created from a
 * `FeedbackSubject`, which carries no description and no article URL, so the
 * keep has to reach for the local row before the 48h prune takes it. Unlike
 * {@link getReasonedSuggestionIdForArticle} this does NOT require a reason — a
 * reason-less row still holds the URL and description that make the article
 * openable, which is the only thing retention needs.
 */
async function getSuggestionByArticleId(articleId) {
  if (!articleId) return null;
  try {
    const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('article_id', articleId), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc)).fetch();
    // Mirror the SQL in JS so the result does not depend on the query engine
    // (and the predicate-ignoring test double stays honest).
    const row = rows.find(r => r.articleId === articleId);
    if (!row) return null;
    const factIds = await loadFactIdsBySuggestion([row.id]);
    return (0, _articleSuggestionMappers.toForYouSuggestion)(row, factIds.get(row.id) ?? []);
  } catch {
    return null;
  }
}

/**
 * Find a suggestion by server id (returns null if not present).
 */
async function getSuggestionByServerId(serverId) {
  try {
    const row = await articleSuggestionsCol.find(serverId);
    const factIds = await loadFactIdsBySuggestion([serverId]);
    return (0, _articleSuggestionMappers.toForYouSuggestion)(row, factIds.get(serverId) ?? []);
  } catch {
    return null;
  }
}

/**
 * Strict twin of getSuggestionByServerId: null ONLY for a missing row, any other
 * failure rethrows. For callers that act on "confirmed gone" (the detail screen
 * purges the card), where a transient read error must not look like a missing row.
 */
async function findSuggestionByServerId(serverId) {
  try {
    const row = await articleSuggestionsCol.find(serverId);
    const factIds = await loadFactIdsBySuggestion([serverId]);
    return (0, _articleSuggestionMappers.toForYouSuggestion)(row, factIds.get(serverId) ?? []);
  } catch (err) {
    // shortcut: 3 copies of the missing-record test (here, saved-article-suggestion-service, inference-results.isRecordNotFoundError); dedupe when one changes.
    if (/Record\s+\S+\s+not\s+found/i.test(err instanceof Error ? err.message : String(err))) return null;
    throw err;
  }
}

/**
 * Assemble the context an article-feedback agent needs: the suggestion row,
 * the topic texts that matched it, and the facts that produced those topics.
 * Looks up by `suggestionId` (server id) or, failing that, by `articleId`
 * (newest matching row). Returns null when no suggestion row exists on-device
 * (non-personalized article — the agent falls back to a generic prompt).
 */
async function getSuggestionFeedbackContext(opts) {
  let row = null;
  if (opts.suggestionId) {
    row = await articleSuggestionsCol.find(opts.suggestionId).catch(() => null);
  }
  if (!row && opts.articleId) {
    const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('article_id', opts.articleId), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc)).fetch();
    row = rows[0] ?? null;
  }
  if (!row) return null;
  const suggestion = (0, _articleSuggestionMappers.toForYouSuggestion)(row);
  const matchedTopicTexts = (0, _articleSuggestionMappers.parseTopicIds)(row.matchedTopicTextsJson);

  // Join article_suggestion_facts → facts (same pattern as resolveFactsByTopicTexts).
  const links = await articleSuggestionFactsCol.query(_watermelondb.Q.where('article_suggestion_id', row.id)).fetch();
  const linkedFactIds = new Set(links.map(l => l.factId));
  const linkedFacts = [];
  if (linkedFactIds.size > 0) {
    const facts = await (0, _factService.getFacts)();
    for (const fact of facts) {
      if (linkedFactIds.has(fact.id)) {
        linkedFacts.push({
          id: fact.id,
          statement: fact.statement
        });
      }
    }
  }

  // Entities (≤8) + category feed the "less of this" choose-one alternatives.
  const entities = (0, _articleSuggestionMappers.parseJsonArray)(row.entitiesJson).filter(e => typeof e === 'string' && e.trim().length > 0).slice(0, 8);
  const category = row.category ?? null;

  // Two more context fields the feedback tree gates/resolves on. Both were
  // already on the row and simply never read, which left
  // `nudge_browse_related` (cluster_size_gte) and every `from_context_geo`
  // leaf dead on EVERY surface, feed included.
  const clusterSize = typeof row.maxClusterSize === 'number' && Number.isFinite(row.maxClusterSize) ? row.maxClusterSize : null;
  const geoTags = (0, _articleSuggestionMappers.parseJsonArray)(row.geoTagsJson);
  const geoText = (0, _articleSuggestionMappers.geoTextFromTags)(geoTags);
  // The same tag's own field, uncooked — the `place` FILTER's value, which
  // `geoText` cannot be (it resolves a supranational code to prose). Derived
  // here rather than from the projected suggestion so it is available on every
  // surface that has a ROW, including the ones whose ForYouSuggestion
  // projection carries no `geoTags` at all (e.g. a saved card).
  const placeValue = (0, _articleSuggestionMappers.placeValueFromTags)(geoTags);
  return {
    suggestion,
    matchedTopicTexts,
    linkedFacts,
    entities,
    category,
    clusterSize,
    geoText,
    placeValue
  };
}
async function getArticleSuggestionsByTopicTexts(topicTexts) {
  if (topicTexts.length === 0) return [];
  const topicSet = new Set(topicTexts);
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.sortBy('first_pub_date', _watermelondb.Q.desc)).fetch();
  return rows.filter(row => {
    const topics = (0, _articleSuggestionMappers.parseTopicIds)(row.matchedTopicTextsJson);
    return topics.some(t => topicSet.has(t));
  });
}

/**
 * Distinct `publication_name` values present in the local suggestion cache,
 * normalized (lower-cased, whitespace-collapsed) and deduped.
 *
 * source-pref v47 — the CORROBORATION set for a named-publication
 * preference. `pubPref` matching is exact normalized-name equality, so a model
 * that invents "Times of India Group" would mint a row that shows up on the
 * Source-preferences screen and can never fire: a preference that looks live
 * and does nothing. Pairing this with `getTopVisitedPublications()` gives the
 * sanitizer names that provably exist in the USER'S OWN data, so an
 * uncorroborated proposal can be dropped outright (there is no keyword fallback
 * for a preference the way there is for a filter).
 *
 * Never throws: a read failure yields an empty set, which drops every named
 * proposal — the safe direction.
 */
async function getDistinctSuggestionPublicationNames() {
  const names = new Set();
  try {
    const rows = await articleSuggestionsCol.query().fetch();
    for (const row of rows) {
      const norm = (0, _normalizeKey.normalizeKeyOrEmpty)(row.publicationName);
      if (norm) names.add(norm);
    }
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'article-suggestion',
        method: 'getDistinctSuggestionPublicationNames'
      }
    });
  }
  return names;
}