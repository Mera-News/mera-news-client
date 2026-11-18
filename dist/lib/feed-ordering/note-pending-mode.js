"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.noteBoxState = noteBoxState;
exports.notePendingMode = notePendingMode;
exports.showsBelowGate = showsBelowGate;
exports.showsChipOnly = showsChipOnly;
var _articleSuggestionStatus = require("../database/article-suggestion-status");
var _pendingVisibility = require("./pending-visibility");
// The ONE rule for what a scored row with no note shows, shared by the Feed
// card, the detail screen and the Feed's sort (`isAwaitingNote`). RN-free, so
// the sort and its tests can import it.

/**
 * The state of a note that is not there yet:
 *  - `writing`: the moving Mera logo beside the fact that found the article
 *    and "Please wait while Mera writes the reason". A `reason_pending` row
 *    always gets its note (the orphaned-reasons sweep re-sends any batch that
 *    did not settle), so this holds between batches too.
 *  - `held`: the day's cloud reading is used up, so the note waits for the
 *    reset; a static line says why and when, with no logo.
 */

/**
 * Only `reason_pending` without a note is pending. Undefined for no status,
 * unscored, a row with its note, `complete`, and every other status
 * (`reason_skipped` shows its fact chips like a complete note-less row).
 * `held` is the cloud reading hold (`useReadHeld().held`), read once per
 * surface by the host.
 */
function notePendingMode(s, held) {
  if (s.status !== _articleSuggestionStatus.ArticleSuggestionStatus.ReasonPending || s.reason) return undefined;
  return held ? 'held' : 'writing';
}

/**
 * A scored row finalised with no note (Skip notes, in either mode; or a
 * cloud reasons batch that failed for good): the card shows the relevance chip
 * alone. Not `reason_skipped` (its fact chips show instead) and not a zero
 * relevance (never scored, or excluded).
 */
function showsChipOnly(s) {
  return s.status === _articleSuggestionStatus.ArticleSuggestionStatus.Complete && !s.reason && (s.relevance ?? 0) > 0;
}

/**
 * Why a note box shows the matched facts instead of an AI note, for its caption
 * (owner, 2026-10-21):
 *  - `writing`: a note is on its way (`reason_pending`).
 *  - `paused`: the day's cloud reading is used up; the note waits for the reset.
 *  - `off`: Skip notes is on, so no note is written.
 *  - `failed`: a note was owed but none came (a refusal or an error).
 *  - `discarded`: Mera read it and scored it below its bar, so no note is
 *    owed (the Show filter's "Discarded by Mera").
 */

function noteBoxState(pending, skipNotes, belowGate = false) {
  if (pending === 'writing') return 'writing';
  if (pending === 'held') return 'paused';
  if (belowGate) return 'discarded';
  return skipNotes ? 'off' : 'failed';
}

/**
 * A row Mera read and scored below the render gate, with no note: the note box
 * shows its chip and the `discarded` caption. Relevance 0 (ineligible) too,
 * which `showsChipOnly` leaves out.
 */
function showsBelowGate(s) {
  return !s.reason && (0, _pendingVisibility.isReadBelowGate)(s);
}