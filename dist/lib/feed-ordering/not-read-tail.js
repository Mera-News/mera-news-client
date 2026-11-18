"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TAIL_RENDER_CAP = exports.FEED_SHOWS = void 0;
exports.applyFeedShow = applyFeedShow;
exports.buildDiscardedStories = buildDiscardedStories;
exports.feedShowCounts = feedShowCounts;
exports.foldNotReadTail = foldNotReadTail;
exports.formatShowCount = formatShowCount;
exports.mayShowNotRead = mayShowNotRead;
exports.newNotReadTailSession = newNotReadTailSession;
exports.newestFirst = newestFirst;
exports.offeredShows = offeredShows;
exports.showsNotReadDivider = showsNotReadDivider;
var _pendingVisibility = require("./pending-visibility");
var _feedListSelector = require("../stores/feed-list-selector");
// not-read-tail — the Continuous view's articles Mera has not read yet.
//
// A story whose elected representative is `unscored` (so EVERY member is: a
// scored member always fronts, see feed-list-selector's `statusRank`) is a
// NOT-READ card. Only those `mayShowNotRead` admits render (owner: never a row
// still waiting for its first read). They come after every scored card, in
// every seen tier, newest published first.
//
// They NEVER enter `feed-order-store`. The store is insert-only (invariant 4),
// and most of a fetch scores below the gate, so a not-read row ingested there
// would linger as a stale card until the next hydrate. Instead the tail is a
// SESSION list here: its membership is fixed for the reading session
// (`resetSession` starts a new one), so nothing jumps under a reader of the
// tail. Within a session:
//   - a tail row that Mera then reads stays in place, showing its new state
//     (the card renders the article's live row); it rises into its band, or
//     drops out, at the next session;
//   - a story that Mera reads and that now fronts a SCORED candidate sharing a
//     member with a tail row is withheld from the scored list and from ingest
//     until then, so one story never shows twice;
//   - not-read stories that arrive mid-session are appended at the end,
//     newest first among themselves.
// The tail is capped at TAIL_RENDER_CAP rows (the newest at session start);
// the waiting count is always the true number of articles.
//
// The Show filter's fourth segment, "Discarded by Mera", lives here too: the
// stories Mera read and scored below the gate (`buildDiscardedStories`). They
// never enter `feed-order-store` either, and never show under All.
//
// PURE: no React, no store, no database.

/**
 * Whether a not-read row may render at all. The Feed shows only what Mera has
 * read (owner): a row still waiting for its first read never renders, and a
 * read hold is not a read. The tail is for rows Mera TRIED and that stayed
 * unscored: `scoreFailedAt` is stamped only once an attempt has FINISHED with
 * no score (never for a hold, a throttle or a row in flight), so no in-flight
 * check is needed here. Not-read rows still count in `notReadArticles` (the
 * counts card's waiting number): that is a fact about the world, not a card.
 */
function mayShowNotRead(s) {
  return s.scoreFailedAt != null;
}

/** At most this many not-read cards render (owner, W14). */
const TAIL_RENDER_CAP = exports.TAIL_RENDER_CAP = 200;
function newNotReadTailSession() {
  return {
    ids: [],
    items: new Map()
  };
}
function pubMs(it) {
  const t = Date.parse(it.suggestion.firstPubDate ?? '');
  return Number.isFinite(t) ? t : 0;
}

/** Newest published first; id breaks a tie. */
function newestFirst(a, b) {
  return pubMs(b) - pubMs(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Fold this render's candidates into the session's tail. Mutates `session`
 * (idempotent for the same candidates, so a double render is safe), the same
 * contract as feed-row-display's `resolveFeedRowDisplay`.
 */
function foldNotReadTail(session, candidates, cap = TAIL_RENDER_CAP, mayShow = mayShowNotRead) {
  const inTail = new Set(session.ids);
  const fresh = [];
  let notReadArticles = 0;
  for (const it of candidates) {
    if (inTail.has(it.id)) {
      session.items.set(it.id, it);
    } else if ((0, _pendingVisibility.isNotRead)(it.suggestion) && mayShow(it.suggestion)) {
      fresh.push(it);
    }
    if ((0, _pendingVisibility.isNotRead)(it.suggestion)) notReadArticles += it.memberCount;
  }
  if (fresh.length > 0 && session.ids.length < cap) {
    fresh.sort(newestFirst);
    for (const it of fresh.slice(0, cap - session.ids.length)) {
      session.ids.push(it.id);
      session.items.set(it.id, it);
      inTail.add(it.id);
    }
  }

  // Member ids the tail holds: a scored story sharing one is the same story.
  const tailMembers = new Set();
  for (const id of session.ids) {
    for (const m of session.items.get(id)?.memberIds ?? []) tailMembers.add(m);
  }
  const withheld = new Set();
  for (const it of candidates) {
    if (inTail.has(it.id)) {
      withheld.add(it.id);
      continue;
    }
    if ((0, _pendingVisibility.isNotRead)(it.suggestion)) continue; // a not-read story past the cap
    if (it.memberIds.some(m => tailMembers.has(m))) withheld.add(it.id);
  }
  const tail = [];
  for (const id of session.ids) {
    const it = session.items.get(id);
    if (it) tail.push(it);
  }
  // Not-read stories past the cap: not rendered, but counted, so the Show menu's
  // number is exact (owner, 2026-10-21: "write the exact number").
  const overflow = candidates.filter(it => (0, _pendingVisibility.isNotRead)(it.suggestion) && mayShow(it.suggestion) && !inTail.has(it.id)).length;
  return {
    tail,
    withheld,
    notReadArticles,
    capped: overflow > 0,
    overflow
  };
}

/** The stories Mera discarded: rows it read and scored below the gate, in
 *  the 48h window, grouped like the main list, keeping only stories with no
 *  member the Feed shows (a pick's, a pending or a not-read sibling keeps the
 *  story out), newest published first, uncapped unless `cap` is given
 *  (`total` is the true story count). Not a session list: these rows are terminal, so only new
 *  ones arrive. */
function buildDiscardedStories(suggestions, userCtx, nowMs = Date.now(), cap = Number.POSITIVE_INFINITY) {
  // Uncapped by default (owner, 2026-10-21): the menu shows the exact number and the list
  // shows every one of them.
  const all = (0, _feedListSelector.buildFeedList)(suggestions, new Set(), nowMs, userCtx, {
    onlyDiscarded: true
  }).sort(newestFirst);
  return {
    rows: all.slice(0, cap),
    total: all.length
  };
}

/** The Show filter (feed-view-prefs `feed_show`). */

const FEED_SHOWS = exports.FEED_SHOWS = ['all', 'picks', 'unread', 'discarded'];

/** What the list renders for a filter: Mera's picks, then the tail (All
 *  never holds a discarded story). `picks` is how many leading rows are
 *  scored (the divider sits after them). */
function applyFeedShow(scored, tail, show, discarded = []) {
  if (show === 'picks') return {
    rows: [...scored],
    picks: scored.length
  };
  if (show === 'unread') return {
    rows: [...tail],
    picks: 0
  };
  if (show === 'discarded') return {
    rows: [...discarded],
    picks: 0
  };
  return {
    rows: [...scored, ...tail],
    picks: scored.length
  };
}

/** How many stories a filter holds: always the exact number (owner, 2026-10-21). */

/** Every Show option's exact story count, from `applyFeedShow` itself so a count
 *  is what that option renders, plus the not-read stories past the tail's render
 *  cap (`tailOverflow`), which exist but are not drawn. */
function feedShowCounts(scored, tail, tailOverflow, discarded, discardedTotal = discarded.length) {
  const extra = {
    all: tailOverflow,
    picks: 0,
    unread: tailOverflow,
    discarded: Math.max(0, discardedTotal - discarded.length)
  };
  const out = {};
  for (const show of FEED_SHOWS) {
    out[show] = {
      n: applyFeedShow(scored, tail, show, discarded).rows.length + extra[show]
    };
  }
  return out;
}

/** The Show options the menu offers. "Not read by Mera" only while it holds a
 *  story (or is the current choice): its rows are those `mayShowNotRead`
 *  admits, so an always-empty option would be a dead end. */
function offeredShows(counts, show) {
  return FEED_SHOWS.filter(o => o !== 'unread' || show === 'unread' || (counts?.unread?.n ?? 0) > 0);
}

/** The count as shown: the exact number, localised by `format`. */
function formatShowCount(c, format) {
  return format(c.n);
}

/** Whether the picks/not-read divider is true: at least one tail card still
 *  SHOWS an article Mera has not read. Tail rows that Mera read stay in place
 *  for the session, so once every one of them is read the divider goes.
 *  `shown` is the article a card shows (feed-row-display's
 *  `displayedSuggestionOf`), never the possibly stale list item. */
function showsNotReadDivider(tail, shown) {
  return tail.some(it => (0, _pendingVisibility.isNotRead)(shown(it)));
}