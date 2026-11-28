"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clearNoteHolds = clearNoteHolds;
exports.holdForOwnNote = holdForOwnNote;
exports.isNoteHeld = isNoteHeld;
exports.releaseNoteHold = releaseNoteHold;
// note-hold — rows that must wait off the Feed for their own note.
//
// A `reason_pending` row normally shows on the Feed with "Writing a note"
// (pending-visibility.ts). A row whose COPIED note was rejected is different:
// it waits off the Feed until its own note lands, so a card never shows a note
// written for another article and then swaps it.
//
// Process memory only. A scoring path holds an id BEFORE the write that leaves
// the row pending with no note (the Feed rebuilds on that write, so nothing
// subscribes here) and releases it once the row's own note lands or the row is
// finalised. After a relaunch the set is empty and a still-owed row shows as an
// ordinary pending card, which never shows a wrong note.
//
// PURE: no React, no store, no database.

const held = new Set();

/** Keep these suggestion ids off the Feed while they are `reason_pending`. */
function holdForOwnNote(ids) {
  for (const id of ids) held.add(id);
}

/** Let these ids show again (their own note landed, or they were finalised). */
function releaseNoteHold(ids) {
  for (const id of ids) held.delete(id);
}
function isNoteHeld(id) {
  return held.has(id);
}

/** Drop every hold: an account reset, or between tests. */
function clearNoteHolds() {
  held.clear();
}