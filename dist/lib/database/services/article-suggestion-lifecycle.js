"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clearSuggestions = clearSuggestions;
exports.deleteOldSuggestions = deleteOldSuggestions;
exports.deleteSuggestionByServerId = deleteSuggestionByServerId;
exports.deleteSuggestionsByServerIds = deleteSuggestionsByServerIds;
exports.loadFeedMetadata = loadFeedMetadata;
exports.persistFeedMetadata = persistFeedMetadata;
exports.pruneOrphanedSuggestions = pruneOrphanedSuggestions;
exports.purgeSuggestionsForDeadTopics = purgeSuggestionsForDeadTopics;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _settingService = require("./setting-service");
var _factService = require("./fact-service");
var _logger = _interopRequireDefault(require("../../logger"));
var _articleSuggestionMappers = require("./article-suggestion-mappers");
var _storyImpressionService = require("./story-impression-service");
var _factRowsSelector = require("../../stores/fact-rows-selector");
var _feedOrderStore = require("../../stores/feed-order-store");
var _readSnapshot = require("../../feed-ordering/read-snapshot");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Article Suggestion Service: delete, prune and feed metadata.

const articleSuggestionsCol = _index.default.get('article_suggestions');
const articleSuggestionFactsCol = _index.default.get('article_suggestion_facts');
async function deleteSuggestionsByServerIds(serverIds) {
  if (serverIds.length === 0) return 0;

  // Row id == server id, so query the primary-key column directly.
  const suggestions = await articleSuggestionsCol.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(serverIds))).fetch();
  if (suggestions.length === 0) return 0;
  const ids = suggestions.map(s => s.id);
  const links = await articleSuggestionFactsCol.query(_watermelondb.Q.where('article_suggestion_id', _watermelondb.Q.oneOf(ids))).fetch();
  await _index.default.write(async () => {
    await _index.default.batch([...links.map(l => l.prepareDestroyPermanently()), ...suggestions.map(s => s.prepareDestroyPermanently())]);
  });
  return suggestions.length;
}
async function deleteSuggestionByServerId(serverId) {
  return (await deleteSuggestionsByServerIds([serverId])) > 0;
}

/**
 * The 48h sweep (`cutoffMs` = now - 48h on `created_at`). Unread High and
 * Emergency stories are spared until 7 days after publish. "Unread" is
 * decided per STORY from the opened set plus the Feed's persisted card state:
 * if any member is read, no member is spared; if any old member qualifies,
 * every old member of that story inside the 7 days stays with it.
 */
async function deleteOldSuggestions(cutoffMs) {
  const old = await articleSuggestionsCol.query(_watermelondb.Q.where('created_at', _watermelondb.Q.lt(cutoffMs))).fetch();
  if (old.length === 0) return 0;
  const keepFrom = cutoffMs + _factRowsSelector.FEED_WINDOW_MS - _factRowsSelector.IMPORTANT_KEEP_MS; // now - 7d
  const recent = old.filter(r => r.firstPubDate.getTime() >= keepFrom);
  let suggestions = old;
  if (recent.length > 0) {
    // Whole pool, so a viewed fresh sibling marks the old members read too.
    const pool = (await articleSuggestionsCol.query().fetch()).map(r => (0, _articleSuggestionMappers.toForYouSuggestion)(r));
    const snap = (0, _readSnapshot.buildReadSnapshot)((0, _readSnapshot.parseCardState)(await (0, _settingService.getSetting)(_feedOrderStore.FEED_CARD_STATE_SETTING_KEY)), await (0, _storyImpressionService.getOpenedSeenSet)(), pool);
    const keysOf = s => [s.articleId, s.clusters.find(c => c.stableClusterId)?.stableClusterId, s.storyKey ? `sk:${s.storyKey}` : null];
    const spareKeys = new Set();
    for (const r of recent) {
      const fy = (0, _articleSuggestionMappers.toForYouSuggestion)(r);
      if ((0, _factRowsSelector.keepsPastFeedWindow)(fy, snap)) for (const k of keysOf(fy)) if (k) spareKeys.add(k);
    }
    if (spareKeys.size > 0) {
      const spared = new Set(recent.filter(r => keysOf((0, _articleSuggestionMappers.toForYouSuggestion)(r)).some(k => k && spareKeys.has(k))).map(r => r.id));
      suggestions = old.filter(r => !spared.has(r.id));
    }
  }
  if (suggestions.length === 0) return 0;
  const ids = suggestions.map(s => s.id);
  const links = await articleSuggestionFactsCol.query(_watermelondb.Q.where('article_suggestion_id', _watermelondb.Q.oneOf(ids))).fetch();
  await _index.default.write(async () => {
    await _index.default.batch([...links.map(l => l.prepareDestroyPermanently()), ...suggestions.map(s => s.prepareDestroyPermanently())]);
  });
  return suggestions.length;
}
async function clearSuggestions() {
  const [suggestions, links] = await Promise.all([articleSuggestionsCol.query().fetch(), articleSuggestionFactsCol.query().fetch()]);
  if (suggestions.length === 0 && links.length === 0) {
    await (0, _settingService.deleteSetting)(FEED_META_KEY);
    return;
  }
  await _index.default.write(async () => {
    await _index.default.batch([...links.map(l => l.prepareDestroyPermanently()), ...suggestions.map(s => s.prepareDestroyPermanently())]);
  });
  await (0, _settingService.deleteSetting)(FEED_META_KEY);
}

/**
 * Deletes suggestions whose matched topic texts are entirely absent from
 * current active facts. Suggestions that still overlap with at least one
 * active topic are preserved (along with their relevance scores).
 * Returns the number of deleted suggestion rows, or -1 if a full clear
 * was performed because no active topics exist.
 */
async function pruneOrphanedSuggestions() {
  const facts = await (0, _factService.getFacts)();
  const activeTopics = new Set();
  for (const fact of facts) {
    for (const topic of fact.metadata?.topics ?? []) {
      if (topic.length > 0) activeTopics.add(topic);
    }
  }
  if (activeTopics.size === 0) {
    await clearSuggestions();
    return -1;
  }
  const allSuggestions = await articleSuggestionsCol.query().fetch();
  const toDelete = allSuggestions.filter(s => {
    const matched = (0, _articleSuggestionMappers.parseTopicIds)(s.matchedTopicTextsJson);
    return matched.length > 0 && matched.every(t => !activeTopics.has(t));
  });
  if (toDelete.length === 0) return 0;
  const toDeleteIds = new Set(toDelete.map(s => s.id));
  const allLinks = await articleSuggestionFactsCol.query().fetch();
  const linksToDelete = allLinks.filter(l => toDeleteIds.has(l.articleSuggestionId));
  await _index.default.write(async () => {
    await _index.default.batch([...linksToDelete.map(l => l.prepareDestroyPermanently()), ...toDelete.map(s => s.prepareDestroyPermanently())]);
  });
  return toDelete.length;
}
const FEED_META_KEY = 'feed_metadata';
async function persistFeedMetadata(meta) {
  await (0, _settingService.setSetting)(FEED_META_KEY, JSON.stringify(meta));
}
async function loadFeedMetadata() {
  const raw = await (0, _settingService.getSetting)(FEED_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Destroy suggestions that survive only because of topics that no longer exist.
 *
 * Deleting a fact removes the interest AND (since the cascade fix) its topics —
 * but the suggestions those topics retrieved stayed on the device forever.
 * They are not merely stale: the Dashboard resolves a suggestion to its section
 * through matched topic → fact, so a suggestion whose every matched topic is
 * gone can never render a section again. It occupies the local feed, counts
 * toward "analysed for you", and is re-read on every rebuild, for an interest
 * the user explicitly deleted. Measured 2026-08-03: a device that deleted all
 * but one fact carried 417 such rows and rendered an empty Dashboard.
 *
 * Conservative by construction — a row is destroyed ONLY when all three hold:
 *   1. it carries at least one matched topic with a real `topicId` (rows with
 *      no topic evidence are never judged here), AND
 *   2. none of those topic ids still exists, AND
 *   3. it is not a top-headline row (`headline_scope` set) — those belong to a
 *      scope section and never depended on a fact in the first place.
 *
 * Returns the number destroyed. Never throws: a failure here must not turn a
 * committed fact deletion into an error.
 */
async function purgeSuggestionsForDeadTopics(liveTopicIds) {
  try {
    const rows = await articleSuggestionsCol.query().fetch();
    const doomed = [];
    for (const row of rows) {
      if (row.headlineScope) continue; // has a scope section regardless
      const refs = (0, _articleSuggestionMappers.parseMatchedTopicRefs)(row.matchedTopicsJson);
      const owned = refs.filter(r => !!r.topicId);
      if (owned.length === 0) continue; // no topic evidence — leave it alone
      if (owned.some(r => liveTopicIds.has(r.topicId))) continue; // still owned
      doomed.push(row);
    }
    if (doomed.length === 0) return 0;

    // The join rows carry the suggestion id, so they must go in the same batch
    // or they outlive their parent as unreachable orphans of their own.
    const suggestionIds = new Set(doomed.map(r => r.id));
    const joins = await articleSuggestionFactsCol.query().fetch();
    const doomedJoins = joins.filter(j => suggestionIds.has(j.articleSuggestionId));
    await _index.default.write(async () => {
      await _index.default.batch([...doomed.map(r => r.prepareDestroyPermanently()), ...doomedJoins.map(j => j.prepareDestroyPermanently())]);
    });
    return doomed.length;
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'article-suggestion',
        method: 'purgeSuggestionsForDeadTopics'
      }
    });
    return 0;
  }
}