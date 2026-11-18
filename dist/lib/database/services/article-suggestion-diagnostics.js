"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getScoringModeBreakdown = getScoringModeBreakdown;
exports.getSharedNoteBreakdown = getSharedNoteBreakdown;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Article Suggestion Service: scoring diagnostics.

const articleSuggestionsCol = _index.default.get('article_suggestions');

/**
 * How many stored notes are SHARED between articles.
 *
 * WHY THIS IS THE READOUT THAT MATTERS. When a note turns up describing a
 * different article than the one it sits on, there are three candidate causes
 * and they are otherwise indistinguishable after the fact: a batch decode that
 * zipped results to articles by array position, a propagated donor reason, or a
 * model that echoed one of its prompt's worked examples. Only ONE of them
 * duplicates a string — propagation copies the donor's sentence byte for byte,
 * so its fingerprint is the same `reason` on two article ids. A decode shift or
 * a confabulation produces a sentence that exists exactly once. So a non-zero
 * `sharedNoteGroups` says "propagation", and a zero says "look at the decoder
 * or the prompt" — without needing an extra column or a single write.
 *
 * Note that sharing is NORMAL and expected in moderation: propagation exists on
 * purpose, so story siblings legitimately share a note. It is the SIZE and the
 * membership of a group that indict it — a group spanning articles that are not
 * the same story is a grouping false positive.
 */

/**
 * Count how many stored notes are shared across articles. See
 * {@link SharedNoteBreakdown} for why this is the diagnostic that discriminates
 * propagation from a decode shift.
 *
 * ON-DEMAND ONLY (the Observability screen's refresh), like
 * {@link getScoringModeBreakdown} beside it: it fetches every row carrying a
 * note. Read-only, and it never throws — a caller renders '—' on failure.
 */
async function getSharedNoteBreakdown() {
  const empty = {
    rowsWithNote: 0,
    distinctNotes: 0,
    sharedNoteGroups: 0,
    rowsSharingANote: 0,
    largestGroupSize: 0,
    largestGroup: null
  };
  // `reason` is NOT NULL with '' for absent, so an inequality against '' is the
  // whole predicate — no null branch needed.
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('reason', _watermelondb.Q.notEq(''))).fetch();
  if (rows.length === 0) return empty;
  const byNote = new Map();
  for (const row of rows) {
    const note = (row.reason ?? '').trim();
    const bucket = byNote.get(note);
    if (bucket) bucket.push(row);else byNote.set(note, [row]);
  }
  let sharedNoteGroups = 0;
  let rowsSharingANote = 0;
  let largest = [];
  let largestNote = '';
  for (const [note, members] of byNote) {
    if (members.length < 2) continue;
    sharedNoteGroups++;
    rowsSharingANote += members.length;
    if (members.length > largest.length) {
      largest = members;
      largestNote = note;
    }
  }
  return {
    rowsWithNote: rows.length,
    distinctNotes: byNote.size,
    sharedNoteGroups,
    rowsSharingANote,
    largestGroupSize: largest.length,
    largestGroup: largest.length > 0 ? {
      note: largestNote.slice(0, 120),
      titles: largest.slice(0, 6).map(r => (r.titleEn ?? '').slice(0, 80))
    } : null
  };
}

/** Whether each stored row's article arrived TAGGED. Counted from the `mode`
 *  recorded in the `score_components_json` audit — no parallel record, no extra
 *  column.
 *
 *  Named for the routing it used to describe. Since the judge was removed every
 *  row is scored by the LLM, so this is a property of the ARTICLE, not of the
 *  scorer. */

/**
 * Count the stored suggestions by whether their article carried server tags.
 *
 * ON-DEMAND ONLY (the Observability screen's refresh). It reads every scored
 * row's audit JSON, so it is deliberately absent from the render, ingest and
 * scroll paths. Read-only.
 *
 * This is how the tagging backfill becomes observable: rows move from
 * `backstop` to `math` as the server starts emitting
 * `geo_tags`/`entities`/`event_type`. Rows scored before the
 * `USE_ARTICLE_TAGS` blanking was removed all read `backstop`, whatever their
 * article actually carried.
 */
async function getScoringModeBreakdown() {
  const out = {
    math: 0,
    backstop: 0,
    unknown: 0
  };
  const rows = await articleSuggestionsCol.query(_watermelondb.Q.where('scored_at', _watermelondb.Q.notEq(null))).fetch();
  for (const row of rows) {
    if (!row.scoreComponentsJson) {
      out.unknown++;
      continue;
    }
    try {
      const {
        mode
      } = JSON.parse(row.scoreComponentsJson);
      if (mode === 'math') out.math++;else if (mode === 'backstop') out.backstop++;else out.unknown++;
    } catch {
      out.unknown++;
    }
  }
  return out;
}