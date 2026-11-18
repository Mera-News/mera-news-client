"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MAX_UPDATE_NOTES = void 0;
exports.notesSince = notesSince;
exports.parseUpdateNotes = parseUpdateNotes;
// Release notes an OTA bundle carries (`EXPO_PUBLIC_OTA_NOTES`, written by
// scripts/ota-publish.js at export time): this update's message plus the recent
// ones on the same branch and runtime. The app cannot read an update's message
// at runtime, and never the messages of updates it skipped, so they travel here.

/** The most notes the "What's new" card lists. */
const MAX_UPDATE_NOTES = exports.MAX_UPDATE_NOTES = 10;

/** The bundle's notes, or [] when absent (a dev build) or malformed. */
function parseUpdateNotes(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(n => !!n && typeof n.at === 'string' && !Number.isNaN(Date.parse(n.at)) && typeof n.message === 'string' && n.message.trim() !== '');
}

/**
 * The notes of every update applied since the one this device last ran (strictly
 * newer than `sinceIso`), newest first, at most MAX_UPDATE_NOTES. With no known
 * last update, only the newest note.
 */
function notesSince(notes, sinceIso) {
  const newestFirst = [...notes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (sinceIso == null) return newestFirst.slice(0, 1);
  const since = Date.parse(sinceIso);
  return newestFirst.filter(n => Date.parse(n.at) > since).slice(0, MAX_UPDATE_NOTES);
}