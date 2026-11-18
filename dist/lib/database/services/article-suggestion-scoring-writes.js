"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.batchMarkAsScoredByIds = batchMarkAsScoredByIds;
exports.batchMarkExcluded = batchMarkExcluded;
exports.batchMarkGateSkipped = batchMarkGateSkipped;
exports.batchMarkReasonSkipped = batchMarkReasonSkipped;
exports.batchMarkScoreFailed = batchMarkScoreFailed;
exports.batchPropagateScores = batchPropagateScores;
exports.batchResetToUnscored = batchResetToUnscored;
exports.rependNotelessRows = rependNotelessRows;
exports.saveReason = saveReason;
exports.saveScoringResult = saveScoringResult;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _articleSuggestionStatus = require("../article-suggestion-status");
var _inferenceResults = require("../../services/inference-results");
var _articleSuggestionMappers = require("./article-suggestion-mappers");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Article Suggestion Service: scoring writes.

const articleSuggestionsCol = _index.default.get('article_suggestions');

/**
 * Is relevance v3 the scorer producing scores RIGHT NOW? Stamped onto each row
 * at write time so the render gate can later be chosen per row rather than from
 * whatever the flag happens to be at read time (see `gateForRow`).
 *
 * ALWAYS FALSE NOW — the v3 scorer is retired, so nothing this app writes is
 * v3-vintage. The stamp is NOT deleted along with it, and that is the whole
 * point: a device that ran the beta can hold v3-scored rows for up to the 48h
 * feed window, and one of them can be RE-scored (score propagation, a re-run
 * after a failed batch). Dropping the write would leave such a row carrying a
 * stale `true` next to a fresh v1-vintage score, gating it at 0.55 — silently
 * deleting a row that should render. Writing `false` retires the vintage with
 * the score it describes.
 */
function isRelevanceV3Active() {
  return false;
}

/**
 * Persists the result of a scoring pass. Callers only invoke this when the
 * relevance step succeeded, so the row leaves `unscored`. The resulting `status`
 * captures where the reason step landed:
 *   - reason non-empty               → complete (reason shown)
 *   - reasonSkipped (sub-threshold)  → complete (terminal, no reason → fact chips)
 *   - otherwise                      → reason_pending (loading; retried next sweep)
 */
async function saveScoringResult(localSuggestionId, params) {
  const {
    relevance,
    reason,
    reasonSkipped,
    computedScore,
    rawScore,
    scoreComponentsJson
  } = params;
  const row = await articleSuggestionsCol.find(localSuggestionId);
  // An ungrounded note becomes '' here, which the status expression below then
  // reads as "no reason yet" — so the row lands on `reason_pending` unless the
  // caller already declared none was owed (`reasonSkipped`).
  const grounded = (0, _articleSuggestionMappers.groundedReasonFor)(row, reason, 'score');
  await _index.default.write(async () => {
    if ((0, _articleSuggestionMappers.isTerminalStatus)(row.status)) return;
    await row.update(r => {
      r.relevance = relevance;
      // Stamp the scorer VINTAGE alongside the score, UNCONDITIONALLY (unlike
      // `scored_at` below, which is a once-only "when did this row leave
      // unscored"). This is a property of THIS score: if a row is ever
      // re-scored by a different scorer, the gate must move with it.
      r.scoredWithV3 = isRelevanceV3Active();
      r.reason = grounded;
      if (computedScore !== undefined) r.computedScore = computedScore;
      if (rawScore !== undefined) r.rawScore = rawScore;
      if (scoreComponentsJson !== undefined) r.scoreComponentsJson = scoreComponentsJson;
      // Stamp scored_at the moment the row leaves `unscored`. Only set
      // it once (a later reason write must not slide the "added" time forward).
      if (r.scoredAt == null) r.scoredAt = Date.now();
      r.status = grounded.length > 0 || reasonSkipped ? _articleSuggestionStatus.ArticleSuggestionStatus.Complete : _articleSuggestionStatus.ArticleSuggestionStatus.ReasonPending;
    });
  });
}

/**
 * Mark multiple articles as ineligible for scoring in a single batched write.
 * All rows get relevance=0 and a terminal `complete` status (no reason). Use
 * instead of calling saveScoringResult in a loop — one database.write instead of N.
 */
async function batchMarkAsScoredByIds(ids) {
  if (ids.length === 0) return;
  // Delete-tolerant: a row can be hard-deleted underneath an in-flight scoring
  // batch (48h TTL sweep, clearSuggestions, pruneOrphanedSuggestions, migration
  // wipes). A bare find(id) throws `Record ... not found` and rejects the whole
  // Promise.all, so resolve missing rows to null and update only the survivors.
  const rows = (await Promise.all(ids.map(id => articleSuggestionsCol.find(id).catch(() => null)))).filter(r => r != null);
  if (rows.length === 0) return;
  await _index.default.write(async () => {
    await _index.default.batch(rows.filter(row => !(0, _articleSuggestionMappers.isTerminalStatus)(row.status)).map(row => row.prepareUpdate(r => {
      r.relevance = 0;
      r.reason = '';
      r.status = _articleSuggestionStatus.ArticleSuggestionStatus.Complete;
    })));
  });
}

/**
 * Mark rows as terminally EXCLUDED by a hard "not interested" filter — one
 * batched write, no scoring of any kind. Relevance/rawScore/computedScore are
 * zeroed and the reason cleared so every downstream gate reads them as
 * invisible: the render gate needs relevance > 0.3, `getScoredDonorRows` needs
 * relevance > 0, and `getScoredSuggestionsWithoutReasons` only ever selects
 * `reason_pending`, so an excluded row is never swept for a missing reason.
 *
 * `scored_at` is stamped only when still null — the column means "when this row
 * left `unscored`", and a purge sweep over already-scored rows must not slide
 * an existing "added" time forward.
 *
 * Delete-tolerant, exactly like batchMarkAsScoredByIds: a row can be
 * hard-deleted underneath an in-flight batch, and a bare find() would reject
 * the whole write.
 */
async function batchMarkExcluded(ids, nowMs = Date.now()) {
  if (ids.length === 0) return;
  const rows = (await Promise.all(ids.map(id => articleSuggestionsCol.find(id).catch(() => null)))).filter(r => r != null);
  if (rows.length === 0) return;
  await _index.default.write(async () => {
    await _index.default.batch(rows.map(row => row.prepareUpdate(r => {
      r.relevance = 0;
      r.reason = '';
      r.rawScore = 0;
      r.computedScore = 0;
      r.status = _articleSuggestionStatus.ArticleSuggestionStatus.Excluded;
      if (r.scoredAt == null) r.scoredAt = nowMs;
    })));
  });
}

/**
 * Records that a scoring attempt FINISHED and left these rows with no score
 * (either lane). Only rows still `unscored` are stamped, so a caller may pass a
 * whole failed batch. Status is untouched: no gate or retry path changes. A
 * later failure re-stamps; a later score just moves the row out of `unscored`.
 */
async function batchMarkScoreFailed(ids, nowMs = Date.now()) {
  if (ids.length === 0) return;
  const rows = (await Promise.all(ids.map(id => articleSuggestionsCol.find(id).catch(() => null)))).filter(r => r != null && r.status === _articleSuggestionStatus.ArticleSuggestionStatus.Unscored);
  if (rows.length === 0) return;
  await _index.default.write(async () => {
    await _index.default.batch(rows.map(row => row.prepareUpdate(r => {
      r.scoreFailedAt = nowMs;
    })));
  });
}

/**
 * The un-exclude direction: send rows back to `unscored` so the next
 * scoring pass treats them as new. Used ONLY by the sweep that runs when a hard
 * filter is retired, and only for rows the sweep has already re-screened
 * against every still-active hard filter. Scores are cleared so a stale 0 can
 * never be mistaken for a real verdict.
 *
 * Delete-tolerant (see batchMarkExcluded).
 */
async function batchResetToUnscored(ids) {
  if (ids.length === 0) return;
  const rows = (await Promise.all(ids.map(id => articleSuggestionsCol.find(id).catch(() => null)))).filter(r => r != null);
  if (rows.length === 0) return;
  await _index.default.write(async () => {
    await _index.default.batch(rows.filter(row => row.status !== _articleSuggestionStatus.ArticleSuggestionStatus.AlreadyRead).map(row => row.prepareUpdate(r => {
      r.relevance = 0;
      r.reason = '';
      r.rawScore = null;
      r.computedScore = null;
      r.scoreComponentsJson = null;
      r.scoredAt = null;
      r.status = _articleSuggestionStatus.ArticleSuggestionStatus.Unscored;
    })));
  });
}

/**
 * Mark already-scored rows as reason-skipped (no eligible facts/title) in one
 * batched write. Keeps existing relevance; reason stays '' and status becomes
 * terminal `complete`.
 */
async function batchMarkReasonSkipped(ids) {
  if (ids.length === 0) return;
  // Delete-tolerant (see batchMarkAsScoredByIds): a row deleted mid-flight must
  // not reject the whole batch — update only the rows still present. This is the
  // writer behind discardLowRelevance, the path the pipeline's apply step drove
  // forever when a row vanished (MERA-APP-53/55).
  const rows = (await Promise.all(ids.map(id => articleSuggestionsCol.find(id).catch(() => null)))).filter(r => r != null);
  if (rows.length === 0) return;
  await _index.default.write(async () => {
    await _index.default.batch(rows.filter(row => !(0, _articleSuggestionMappers.isTerminalStatus)(row.status)).map(row => row.prepareUpdate(r => {
      r.status = _articleSuggestionStatus.ArticleSuggestionStatus.Complete;
    })));
  });
}

/**
 * Skip notes turned off, cloud or on this phone: rows finalised `complete`
 * without a note at or above `gate` go back to `reason_pending`, so the mode's
 * sweep writes them (the on-device notes sweep, or the cloud orphaned-reasons
 * sweep). No column records which scorer wrote a row. Besides the switch, the
 * only writer of that combination is a cloud reasons batch that failed for good
 * (scoring-pipeline marks its rows reason-skipped), and owing such a row a note
 * again is what it lacked anyway. Returns how many rows went back.
 */
async function rependNotelessRows(gate) {
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.Complete), _watermelondb.Q.where('relevance', _watermelondb.Q.gte(gate)), _watermelondb.Q.or(_watermelondb.Q.where('reason', ''), _watermelondb.Q.where('reason', null))).fetch();
  if (rows.length === 0) return 0;
  await _index.default.write(async () => {
    await _index.default.batch(rows.map(row => row.prepareUpdate(r => {
      r.status = _articleSuggestionStatus.ArticleSuggestionStatus.ReasonPending;
    })));
  });
  return rows.length;
}

/**
 * Terminal write for the v4 tag reason-gate: the row KEEPS its real relevance
 * and moves to `reason_skipped`.
 *
 * Deliberately NOT `batchMarkReasonSkipped` above, which sets `complete` — that
 * one is for rows whose score already put them under the render gate, so
 * `complete` is harmless (they are invisible on score alone). A gated row is
 * ABOVE the gate; marking it `complete` would render it with a blank note.
 *
 * Relevance is untouched on purpose. The previous implementation overwrote it
 * with `feedVerifierDemoteScore` (0.28) to force invisibility, which threw away
 * a score an LLM call had just produced and misreported "we chose not to write a
 * note" as "this scored badly". Invisibility now comes from the status.
 */
async function batchMarkGateSkipped(ids) {
  if (ids.length === 0) return;
  // Delete-tolerant, same rationale as batchMarkReasonSkipped.
  const rows = (await Promise.all(ids.map(id => articleSuggestionsCol.find(id).catch(() => null)))).filter(r => r != null);
  if (rows.length === 0) return;
  await _index.default.write(async () => {
    await _index.default.batch(rows.filter(row => !(0, _articleSuggestionMappers.isTerminalStatus)(row.status)).map(row => row.prepareUpdate(r => {
      r.status = _articleSuggestionStatus.ArticleSuggestionStatus.ReasonSkipped;
    })));
  });
}

/**
 * One batched write applying propagated scores (sibling stories inheriting a
 * donor's relevance + reason).
 *
 * STATUS IS CONDITIONAL, and the condition is "was a reason actually
 * propagated?":
 *   - reason non-empty → `complete`. Terminal, and the orphaned-reasons sweep
 *     never touches it — which is the entire point: propagation just saved that
 *     row's LLM reason call, and re-spending it would defeat the mechanism.
 *   - reason EMPTY     → `reason_pending`, and `reason` is left untouched.
 *
 * This was an UNCONDITIONAL `complete`, justified by that same "don't re-spend
 * the saved LLM calls" argument. The argument only holds when a reason was
 * actually copied. `getScoredDonorRows` qualifies donors on
 * `status != unscored ∧ relevance > 0` with NO reason predicate, so a donor
 * still sitting in `reason_pending` (scored, reason not back yet) is fully
 * eligible and donates `''`. Stamping `complete` on that copy produced a row
 * that was VISIBLE (the inherited relevance clears the render gate),
 * REASON-LESS (so the card fell back to its fact chips), and UNREACHABLE by
 * `getScoredSuggestionsWithoutReasons`, which selects `reason_pending` ONLY.
 * That is permanently broken, not transient — the donor later self-corrects via
 * `saveReason` while the propagated sibling never does. Leaving it
 * `reason_pending` costs exactly one reason call and hands the row to the
 * recovery sweep that already exists (`enqueueOrphanedReasons` keeps rows with
 * `relevance > REASON_RELEVANCE_THRESHOLD`, which an inherited above-gate
 * relevance satisfies). Do not restore the unconditional write.
 *
 * `reason` is deliberately NOT written when empty, so a propagation from a
 * reason-less donor can never CLEAR a reason the row already had. That keeps
 * reason-presence monotonic — a card can gain an explanation, never lose one.
 *
 * A donor sentence that fails `groundedReasonFor` against the RECIPIENT's
 * article is treated exactly like an empty one (see the note at the call site).
 * The relevance still propagates either way — grouping is evidence about the
 * story, and holding a score back would silently hide the row.
 *
 * Mirrors batchMarkAsScoredByIds's prepareUpdate+batch shape.
 */
/** One inherited score. `scoredWithV3` is the DONOR's scorer vintage — it
 *  travels with the score so the recipient is gated at the cutoff that score
 *  was calibrated for (see `gateForRow`, lib/stores/fact-rows-selector.ts).
 *  Null/absent = legacy vintage. */

/** Returns the ids it left `reason_pending` (an empty or ungrounded note on an
 *  above-gate score), so a caller can send them for their own note. */
async function batchPropagateScores(entries) {
  if (entries.length === 0) return [];
  // Delete-tolerant (see batchMarkAsScoredByIds): skip entries whose row was
  // deleted mid-flight rather than rejecting the whole batch.
  const entryById = new Map(entries.map(e => [e.id, e]));
  const rows = (await Promise.all(entries.map(e => articleSuggestionsCol.find(e.id).catch(() => null)))).filter(r => r != null);
  if (rows.length === 0) return [];
  const leftPending = [];
  await _index.default.write(async () => {
    await _index.default.batch(rows.filter(row => !(0, _articleSuggestionMappers.isTerminalStatus)(row.status)).map(row => {
      const entry = entryById.get(row.id);
      // `?? ''` is defensive only — the type says string, but this value comes
      // from a donor ROW, and a partially-written row can carry null.
      const propagatedReason = (entry.reason ?? '').trim();
      // The donor's sentence is checked against THIS row's article, not the
      // donor's. That is the whole point: story grouping is union-find, so a
      // transitive merge (A–B by cluster id, B–C by title overlap) can hand C
      // a verdict written about A. The relevance still propagates — grouping
      // is evidence about the STORY — but a sentence naming A's event, place
      // or policy is simply false on C's card, and this is where that is
      // caught. A rejected donor leaves the row exactly where a reason-less
      // donor leaves it: `reason_pending`, owed its own call.
      const grounded = (0, _articleSuggestionMappers.groundedReasonFor)(row, propagatedReason, 'propagation');
      const update = row.prepareUpdate(r => {
        r.relevance = entry.relevance;
        // The gate is chosen by the scorer that produced the SCORE, and this
        // row's score is the donor's. Leaving the recipient's own vintage in
        // place would judge an inherited v3 number at the legacy 0.4 gate.
        // `?? null` keeps pre-v50 donors reading as legacy.
        r.scoredWithV3 = entry.scoredWithV3 ?? null;
        if (grounded.length > 0) {
          r.reason = grounded;
          r.status = _articleSuggestionStatus.ArticleSuggestionStatus.Complete;
        } else if (entry.relevance < _inferenceResults.REASON_RELEVANCE_THRESHOLD) {
          // Below the reason gate nothing will ever write a note (inference-results.ts
          // KEEP/REASON thresholds: no band in between), so finalize like batchMarkReasonSkipped.
          r.status = _articleSuggestionStatus.ArticleSuggestionStatus.Complete;
        } else {
          r.status = _articleSuggestionStatus.ArticleSuggestionStatus.ReasonPending;
        }
      });
      if (grounded.length === 0 && entry.relevance >= _inferenceResults.REASON_RELEVANCE_THRESHOLD) leftPending.push(row.id);
      return update;
    }));
  });
  return leftPending;
}

/**
 * Updates the reason for an already-scored row. A non-empty reason transitions
 * the row to `complete`; an empty reason leaves it `reason_pending` for the
 * next sweep.
 */
async function saveReason(localSuggestionId, reason) {
  const row = await articleSuggestionsCol.find(localSuggestionId);
  // Dropped here, the row simply stays `reason_pending` and the sweep that
  // brought us here will try again — which is the right outcome: this path
  // exists precisely to fill a missing note, so a wrong one is no progress.
  const grounded = (0, _articleSuggestionMappers.groundedReasonFor)(row, reason, 'reason-sweep');
  await _index.default.write(async () => {
    if ((0, _articleSuggestionMappers.isTerminalStatus)(row.status)) return;
    await row.update(r => {
      r.reason = grounded;
      r.status = grounded.length > 0 ? _articleSuggestionStatus.ArticleSuggestionStatus.Complete : _articleSuggestionStatus.ArticleSuggestionStatus.ReasonPending;
    });
  });
}