"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FEED_ALGO_SETTING_KEY = exports.FEED_ALGO_DEFAULTS = void 0;
exports.parseFeedAlgo = parseFeedAlgo;
exports.readOptionsOf = readOptionsOf;
// feed-algo — the reader's Feed algorithm choices, stored as one JSON settings
// row. Pure: callers read the row and hand the raw string to `parseFeedAlgo`.
//
// The function-level options in read-snapshot, fact-rows-selector and
// feed-entries default to the older behaviour when absent; only a caller that
// passes parsed prefs gets the reader defaults below.

/** Settings-KV key the reader's choices live under. Device-local, not synced. */
const FEED_ALGO_SETTING_KEY = exports.FEED_ALGO_SETTING_KEY = 'feed_algo';
const FEED_ALGO_DEFAULTS = exports.FEED_ALGO_DEFAULTS = {
  skippedIsRead: true,
  keepDays: 7,
  mediumStaysAbove: true,
  seenBelowFold: true,
  highSinks: false
};
const KEEP_DAYS = [2, 3, 7];

/** Parse the stored row. Every missing or invalid field takes its default; never throws. */
function parseFeedAlgo(raw) {
  let o = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) o = parsed;
  } catch {
    // malformed row: all defaults
  }
  const bool = k => typeof o[k] === 'boolean' ? o[k] : FEED_ALGO_DEFAULTS[k];
  return {
    skippedIsRead: bool('skippedIsRead'),
    keepDays: KEEP_DAYS.includes(o.keepDays) ? o.keepDays : FEED_ALGO_DEFAULTS.keepDays,
    mediumStaysAbove: bool('mediumStaysAbove'),
    seenBelowFold: bool('seenBelowFold'),
    highSinks: bool('highSinks')
  };
}

/** The read-snapshot options these prefs mean. */
function readOptionsOf(p) {
  return {
    skippedIsRead: p.skippedIsRead,
    keepMs: p.keepDays * 24 * 3600_000
  };
}

/** The layout options `layoutFeed` takes; each absent one keeps the older behaviour. */