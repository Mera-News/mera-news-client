"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.purgeHardFilteredByIds = purgeHardFilteredByIds;
exports.purgeHardFilteredSuggestions = purgeHardFilteredSuggestions;
exports.refreshHardFilterLabels = refreshHardFilterLabels;
exports.unexcludeRetiredHardFilters = unexcludeRetiredHardFilters;
var _logger = _interopRequireDefault(require("../logger"));
var _articleSuggestionScoringWrites = require("../database/services/article-suggestion-scoring-writes");
var _articleSuggestionMappers = require("../database/services/article-suggestion-mappers");
var _articleSuggestionReads = require("../database/services/article-suggestion-reads");
var _stageScoring = require("../mera-protocol/stage-scoring");
var _suppression = require("../news-harness/scoring-engine/suppression");
var _feedOrderStore = require("../stores/feed-order-store");
var _hardFilterLabelStore = require("../stores/hard-filter-label-store");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// suppression-sweep — hard "not interested" filters are RETROACTIVE.
//
// Adding a hard filter (or muting a publication) must not only change what the
// NEXT scoring pass keeps — it must also remove what is already stored and
// already on screen. Retiring one must give those articles a second chance.
// This module owns both directions:
//
//   purgeHardFilteredSuggestions()   — screen every stored row against the
//     currently-active hard filters, mark the matches terminal `excluded`, and
//     drop exactly those ids from the Feed tab's persisted order.
//
//   purgeHardFilteredByIds(ids)      — the same screen scoped to a known id set,
//     for the one path that writes a renderable score WITHOUT ever passing
//     through the scoring stage's hard screen: score propagation. See the scoped-variant note
//     below.
//
//   refreshHardFilterLabels()        — The screen run for its OTHER half:
//     top-headline rows are EXEMPT from exclusion (demoted instead), so the two
//     purges above walk straight past them. This recomputes which stored rows
//     are in that state and publishes the labels the cards render, so a filtered
//     subject on screen is never unexplained.
//
//   unexcludeRetiredHardFilters()    — the mirror. Re-screen the already-
//     excluded rows against every STILL-ACTIVE hard filter; the ones nothing
//     matches any more go back to `unscored` so the next pass scores them
//     fresh. A row blocked by two filters stays excluded until both are gone.
//     Headline rows are skipped outright — an excluded headline is a LOW-band
//     cull, not a filter exclusion (see the function's HEADLINE GUARD note).
//
// All three read the persona snapshot LIVE, so the caller's only obligation is
// to have committed its suppression/publication-preference change first. None
// takes a filter as an argument — that is what makes the two-filter case
// correct for free.
//
// WHY THE SCOPED VARIANT EXISTS. `batchPropagateScores` copies a scored
// donor's relevance/reason onto its unscored siblings and marks them terminal
// `complete`. Those rows never enter computeMathStage/computeAndScore, which is
// where `screenHardSuppressions` runs — so a hard-blocked article could inherit
// a passing score and render, defeating the "Blocked / never show me these at
// all" promise. Reconciling at the propagation callers closes that hole with
// the SAME matcher (one matcher is a load-bearing invariant)
// instead of adding a second screening path. It is scoped rather than a full
// `purgeHardFilteredSuggestions()` because feed-sync runs the gate once per
// hydrate CHUNK, so a full-table screen there would be O(chunks × all rows).
//
// WIRING: `persona-mutation-sweeps.ts` runs the two full sweeps for the
// persona-action executor (ADD_SUPPRESSION / RETIRE_SUPPRESSION /
// SET_PUBLICATION_PREF); the scoped variant is wired into the four propagation
// call sites (feed-sync-steps, run-inference-handler, scoring-pipeline ×2).

/**
 * Rehydrate stored rows into engine inputs, exactly as the scoring stage does
 * (`stage-scoring::buildStageCandidates`). Every screen in this module goes
 * through here, so there is one answer to "what does a filter see" rather than
 * one per subsystem.
 *
 * The server's tags are passed through UNCHANGED. `applyArticleTagPolicyAll`
 * used to blank them here so this sweep matched the scoring stage's blanking;
 * both are deleted. That symmetry still holds — neither blanks now — and it is
 * the reason this file had to change in the same commit: a filter that matches
 * during scoring but not during the sweep (or vice versa) is a row that
 * reappears after being filtered.
 */
function toScreeningInputs(rows, topicWeights) {
  return rows.map(r => (0, _articleSuggestionMappers.buildStageCandidateInput)(r, topicWeights));
}

/** Lazy require, mirroring scoring-pipeline's own refreshUi: a static import of
 *  SuggestionSyncService from here would close a load-time cycle. */
async function refreshUi() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./SuggestionSyncService");
  await mod.refreshSuggestionsInStoreUnsafe();
}

/**
 * Screen every stored suggestion that is not already excluded
 * against the live hard filters, mark the matches terminal, evict exactly those
 * ids from the Feed tab, and refresh the UI.
 *
 * Rehydration note: this goes through `toScreeningInputs`, i.e. the same pure
 * mapper (`buildStageCandidateInput`) AND the same article-tag policy that
 * `buildStageCandidates` applies — so a filter can never match on a field the
 * scorer was not allowed to see. It deliberately does NOT load
 * `article_suggestion_facts`: the hard screen reads only ScoredCandidateInput
 * fields, and the fact links exist for the legacy backstop LLM payload alone.
 */
async function purgeHardFilteredSuggestions(nowMs = Date.now()) {
  const {
    persona,
    topicWeights
  } = await (0, _stageScoring.loadPersonaScoringContext)(nowMs);
  if (!persona.hardSuppressions?.length) return EMPTY_PURGE();
  const rows = await (0, _articleSuggestionReads.getStageRowsForScreening)();
  return screenExcludeAndEvict(rows, persona.hardSuppressions, topicWeights, nowMs, 'purged hard-filtered suggestions');
}

/**
 * The SCOPED screen: same matcher, same exclusion, same eviction — but over
 * exactly `ids` instead of the whole table. Written for the score-propagation
 * reconcile (rows that were handed a donor's score without ever meeting the
 * scoring stage's hard screen).
 *
 * Ordered cheapest-check-first: an empty id list costs nothing, and no hard
 * filters costs one persona read and zero row reads — which is the overwhelming
 * majority of syncs.
 */
async function purgeHardFilteredByIds(ids, nowMs = Date.now()) {
  if (ids.length === 0) return EMPTY_PURGE();
  const {
    persona,
    topicWeights
  } = await (0, _stageScoring.loadPersonaScoringContext)(nowMs);
  if (!persona.hardSuppressions?.length) return EMPTY_PURGE();
  const rows = await (0, _articleSuggestionReads.getStageRowsByIds)(ids);
  return screenExcludeAndEvict(rows, persona.hardSuppressions, topicWeights, nowMs, 'purged hard-filtered propagated rows');
}
function EMPTY_PURGE() {
  return {
    excludedIds: [],
    valueById: new Map(),
    evictedFromFeed: 0
  };
}

/**
 * The one screen-and-exclude body both purge entry points share, so there is
 * exactly ONE matcher call, ONE `batchMarkExcluded`, and ONE feed eviction rule
 * in this module. Callers differ only in which rows they hand it.
 */
async function screenExcludeAndEvict(rows, hard, topicWeights, nowMs, logLabel) {
  if (rows.length === 0) return EMPTY_PURGE();

  // `screenHardSuppressions` returns the rows to REMOVE only — since the headline exemption that
  // excludes top-headline rows, which stay (demoted) and are labelled instead by
  // `refreshHardFilterLabels`. The exemption therefore cannot fight the purge:
  // both read the one predicate through the one matcher, so a headline row is
  // never marked `excluded` here only to be re-scored back in on the next pass.
  const valueById = (0, _suppression.screenHardSuppressions)(toScreeningInputs(rows, topicWeights), hard);
  if (valueById.size === 0) return EMPTY_PURGE();
  const excludedIds = [...valueById.keys()];
  await (0, _articleSuggestionScoringWrites.batchMarkExcluded)(excludedIds, nowMs);

  // Filter-scoped eviction: exactly these ids, nothing inferred.
  const orderBefore = _feedOrderStore.useFeedOrderStore.getState().order.length;
  _feedOrderStore.useFeedOrderStore.getState().removeIds(excludedIds);
  const evictedFromFeed = orderBefore - _feedOrderStore.useFeedOrderStore.getState().order.length;
  _logger.default.info(`[suppression-sweep] ${logLabel}`, {
    scanned: rows.length,
    excluded: excludedIds.length,
    evictedFromFeed,
    values: [...new Set(valueById.values())].slice(0, 10)
  });
  await refreshUi();
  return {
    excludedIds,
    valueById,
    evictedFromFeed
  };
}

/**
 * Recompute — and publish — the "you filtered this, showing it because it's
 * major news" labels.
 *
 * Runs the SAME hard screen the purge runs, over the SAME rehydrated candidate
 * inputs, and keeps the half the purge discards: the top-headline rows that
 * matched a filter and were exempted from exclusion. Nothing is written to the
 * database; the result is a derived, in-memory map (see
 * `stores/hard-filter-label-store`) so retiring a filter drops its labels on the
 * next pass with no cleanup step.
 *
 * Cheap-path first: no hard filters ⇒ one persona read, zero row reads, and the
 * store's own no-op guard means subscribed cards do not re-render.
 *
 * @returns the published map (suggestionId → filter display value).
 */
async function refreshHardFilterLabels(nowMs = Date.now()) {
  const publish = m => {
    _hardFilterLabelStore.useHardFilterLabelStore.getState().setLabels(Object.fromEntries(m));
    return m;
  };
  const {
    persona,
    topicWeights
  } = await (0, _stageScoring.loadPersonaScoringContext)(nowMs);
  if (!persona.hardSuppressions?.length) return publish(new Map());
  const rows = await (0, _articleSuggestionReads.getStageRowsForScreening)();
  if (rows.length === 0) return publish(new Map());
  const {
    exempted
  } = (0, _suppression.screenHardSuppressionsDetailed)(toScreeningInputs(rows, topicWeights), persona.hardSuppressions);
  if (exempted.size > 0) {
    _logger.default.info('[suppression-sweep] labelled filtered-but-shown headlines', {
      scanned: rows.length,
      labelled: exempted.size,
      values: [...new Set(exempted.values())].slice(0, 10)
    });
  }
  return publish(exempted);
}

/**
 * The un-exclude direction, run AFTER the filter has been retired /
 * unmuted. Every currently-excluded row is re-screened against the filters that
 * are STILL active; only rows nothing matches are reset to `unscored`.
 *
 * They come back as `unscored`, never resurrected as scored rows: the score
 * they would have had was never computed, and any stale one would be a lie.
 *
 * HEADLINE GUARD. `excluded` no longer means "a hard filter killed it": the
 * LOW-band top-headline cull (feed-ordering/importance-filter) writes the same
 * terminal status for a scoring OUTCOME. The two are separable with certainty
 * and without a new column, because headline rows are EXEMPT from hard-filter
 * exclusion (scoring-engine/suppression::isHardFilterExempt) — no filter can
 * ever have excluded one. So `excluded && headlineScope != null` is by
 * construction a cull, and it matches no active filter, which is exactly the
 * condition this sweep releases on. Left unguarded, retiring ANY unrelated
 * filter would resurrect EVERY culled headline into `unscored`, burn a scoring
 * pass on it, and cull it again — a churn loop paid for in inference.
 */
async function unexcludeRetiredHardFilters(nowMs = Date.now()) {
  const excludedRows = await (0, _articleSuggestionReads.getStageRowsForScreening)({
    excluded: true
  });
  const rows = excludedRows.filter(r => r.headlineScope == null);
  if (rows.length === 0) return {
    resetIds: [],
    stillExcluded: 0
  };
  const {
    persona,
    topicWeights
  } = await (0, _stageScoring.loadPersonaScoringContext)(nowMs);
  // No active hard filters left ⇒ nothing can still be blocked ⇒ release all.
  const stillBlocked = persona.hardSuppressions?.length ? (0, _suppression.screenHardSuppressions)(toScreeningInputs(rows, topicWeights), persona.hardSuppressions) : new Map();
  const resetIds = rows.map(r => r.id).filter(id => !stillBlocked.has(id));
  if (resetIds.length === 0) {
    return {
      resetIds: [],
      stillExcluded: stillBlocked.size
    };
  }
  await (0, _articleSuggestionScoringWrites.batchResetToUnscored)(resetIds);
  _logger.default.info('[suppression-sweep] released previously excluded suggestions', {
    scanned: rows.length,
    reset: resetIds.length,
    stillExcluded: stillBlocked.size
  });
  await refreshUi();
  return {
    resetIds,
    stillExcluded: stillBlocked.size
  };
}