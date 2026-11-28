"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FEED_RECENCY_WEIGHT = exports.FEED_HALF_LIFE_HOURS = exports.FEED_BREAKING_RECENCY_BONUS = void 0;
exports.buildFeedList = buildFeedList;
exports.feedCompare = feedCompare;
exports.feedScore = feedScore;
exports.resolveExistingOrderId = resolveExistingOrderId;
exports.stableClusterIdOf = stableClusterIdOf;
var _storyGrouping = require("../algorithms/story-grouping");
var _factRowsSelector = require("./fact-rows-selector");
var _representativeCompare = require("../algorithms/representative-compare");
var _pendingVisibility = require("../feed-ordering/pending-visibility");
var _publicationTags = require("../feed-ordering/publication-tags");
var _articleSuggestionStatus = require("../database/article-suggestion-status");
var _priorityOrder = require("../feed-ordering/priority-order");
// feed-list-selector — a pure composite-score selector over the same
// render-gated suggestion pool the swipe deck and fact-rows feed consume.
// Produces a single flat, ordered list (one card per collapsed story) ranked
// by a frozen "importance + recency decay" score rather than the deck's
// breaking-first / rawScore-desc ordering.
//
// PURE: RN-free. It consumes the store's `ForYouSuggestion` rows + an
// excluded-id set and returns plain data; no DB / expo / react-native
// imports, so it unit-tests without a device.
//
// Pipeline (deliberately clones `buildSwipeStack`'s body — filter → group →
// pick a representative → drop excluded reps → sort — so grouping/visibility
// stay a single source of truth via the shared fact-rows-selector /
// story-grouping primitives; only the final ranking differs, so per the repo's
// "three similar lines beat a premature abstraction" rule this is copied, not
// factored out of swipe-stack-selector.ts):
//   filter to visible (note-gated + render gate + FEED_WINDOW_MS) → story-group →
//   pick a representative per group → drop reps already excluded (opened ∪
//   viewed) → freeze each rep's composite `feedScore` → sort by
//   `feedCompare` (score desc → pubDate desc → id asc).

/** Exponential-decay half-life (hours) for the recency term of `feedScore`. */
const FEED_HALF_LIFE_HOURS = exports.FEED_HALF_LIFE_HOURS = 6;

/** Base weight of the recency term (before any breaking bonus). */
const FEED_RECENCY_WEIGHT = exports.FEED_RECENCY_WEIGHT = 0.5;

/** Extra recency weight added on top of `FEED_RECENCY_WEIGHT` for breaking
 *  stories, so a fresh breaking story's decay term outweighs a fresh
 *  non-breaking one even at identical rawScore. */
const FEED_BREAKING_RECENCY_BONUS = exports.FEED_BREAKING_RECENCY_BONUS = 0.6;

/** One card in the composite-score feed list (a collapsed multi-source
 *  story). */

/** The representative's top stable cluster id (the rep-switch dedupe key), or
 *  null when the story has no stable cluster. Lives here rather than in
 *  feed-order-store so pure consumers (the funnel diagnostic) can reuse it
 *  without importing that store, which pulls in the SQLite adapter at module
 *  load. */
function stableClusterIdOf(item) {
  return item.suggestion.clusters?.find(c => c.stableClusterId)?.stableClusterId ?? null;
}

/**
 * Resolve an incoming item to an EXISTING feed-order id when it is the same
 * story under a new representative. Checks the stable cluster id first (the
 * strong signal), then any member article id.
 *
 * `identityToOrderId` must be built ONLY over order rows not already claimed by
 * an exact-id match — see `feed-order-store.ingest`'s two-pass comment.
 */
function resolveExistingOrderId(it, identityToOrderId) {
  const scid = stableClusterIdOf(it);
  if (scid) {
    const hit = identityToOrderId.get(scid);
    if (hit) return hit;
  }
  for (const mid of it.memberIds ?? []) {
    const hit = identityToOrderId.get(mid);
    if (hit) return hit;
  }
  return null;
}
function parseMs(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

// Representative election (`makeRepCompare`) lives in
// `@/lib/algorithms/representative-compare`. It used to be duplicated here
// and in `fact-rows-selector`, byte-identically and by hand; it is now imported
// by both so the Feed and the Dashboard cannot drift apart on which article
// fronts a given story.

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Age of a suggestion's `createdAt`, in hours, at `nowMs`. An unparseable
 *  `createdAt` (NaN from `Date.parse`) is treated as infinitely old — NOT as
 *  age 0 — so a corrupt/missing timestamp never wins on freshness; it falls
 *  back to being ranked on `rawScore` alone (the decay term below evaluates
 *  to `Math.pow(2, -Infinity)` = 0). */
function ageHoursOf(createdAt, nowMs) {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - t) / 3_600_000;
}

/**
 * Composite ranking score: clamped importance (`rawScore`, capped at 1.2)
 * plus an exponentially-decaying recency term, boosted for breaking stories.
 *
 *   score = clamp(rawScore ?? 0, 0, 1.2)
 *         + (FEED_RECENCY_WEIGHT + (isBreaking ? FEED_BREAKING_RECENCY_BONUS : 0))
 *           * 2^(-ageHours / FEED_HALF_LIFE_HOURS)
 *
 * @param s     the suggestion to score.
 * @param nowMs injected clock (deterministic testing).
 */
function feedScore(s, nowMs) {
  const importance = clamp(s.rawScore ?? 0, 0, 1.2);
  const ageHours = ageHoursOf(s.createdAt, nowMs);
  const recencyWeight = FEED_RECENCY_WEIGHT + ((0, _factRowsSelector.isBreaking)(s) ? FEED_BREAKING_RECENCY_BONUS : 0);
  const decay = Math.pow(2, -ageHours / FEED_HALF_LIFE_HOURS);
  return importance + recencyWeight * decay;
}

/**
 * List ordering: frozen composite score desc, then rep `firstPubDate` desc,
 * then id asc for a fully-deterministic tie-break.
 */
function feedCompare(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  const pa = parseMs(a.suggestion.firstPubDate);
  const pb = parseMs(b.suggestion.firstPubDate);
  if (pa !== pb) return pb - pa;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/** Fronting rank inside a story: a member with its note, then one still
 *  waiting for it, then one Mera has not read. */
function statusRank(s) {
  if (s.status === _articleSuggestionStatus.ArticleSuggestionStatus.Complete) return 0;
  return s.status === _articleSuggestionStatus.ArticleSuggestionStatus.Unscored ? 2 : 1;
}

/**
 * Build the ordered composite-score feed list from the live suggestion pool
 * + the excluded-id set.
 *
 * @param suggestions the live `ForYouSuggestion` pool.
 * @param excludedIds article_id ∪ stable_cluster_id of every opened OR
 *                    viewed story.
 * @param nowMs       injected clock (deterministic testing), captured once
 *                    and used to freeze every item's `score`.
 * @param userCtx     the user's geo/language context (home/other countries +
 *                    app language) — makes representative ELECTION tier-aware
 *                    (see `makeRepCompare`). `null` (default) preserves the
 *                    legacy geo/language-blind pick. List ordering
 *                    (`feedCompare`) is unaffected.
 */
function buildFeedList(suggestions, excludedIds, nowMs = Date.now(), userCtx = null, opts = {}) {
  const cutoffMs = nowMs - _factRowsSelector.FEED_WINDOW_MS;
  const includePending = opts.includeReasonPending === true;
  const includeUnscored = opts.includeUnscored === true;
  const baseRepCompare = (0, _representativeCompare.makeRepCompare)(userCtx);
  // With pending or unscored rows in the pool, a member whose note exists
  // fronts the story ahead of one still being written, and either ahead of
  // one Mera has not read (`statusRank`); the shared rule decides the rest.
  // Without them every member is complete and this is the shared rule exactly.
  const bandFirst = opts.bandFirst === true;
  const repCompareForGroups = includePending || includeUnscored || bandFirst ? (a, b) => {
    const pa = statusRank(a.s);
    const pb = statusRank(b.s);
    if (pa !== pb) return pa - pb;
    if (bandFirst) {
      const ba = (0, _priorityOrder.relevanceBandRank)(a.s.relevance ?? 0);
      const bb = (0, _priorityOrder.relevanceBandRank)(b.s.relevance ?? 0);
      if (ba !== bb) return ba - bb;
    }
    return baseRepCompare(a, b);
  } : baseRepCompare;

  // 1. Visible pool (note-gated + render gate + FEED_WINDOW_MS). Same gate the
  //    swipe deck / fact-rows feeds use, so every surface agrees on what is
  //    showable. The Feed widens it to scored rows still awaiting their note.
  //    A muted publication's rows never enter (Mute means skip; the scoring
  //    screen excludes new ones, this catches rows scored before the mute).
  const visible = [];
  const discarded = [];
  for (const s of suggestions) {
    if ((0, _publicationTags.isMutedPublication)(s.publication_name, userCtx)) continue;
    const shown = (0, _factRowsSelector.isVisible)(s, cutoffMs, opts.read) || (includePending || opts.onlyDiscarded) && (0, _pendingVisibility.isReasonPendingVisible)(s, cutoffMs) || (includeUnscored || opts.onlyDiscarded) && (0, _pendingVisibility.isUnscoredVisible)(s, cutoffMs);
    if (shown) visible.push(s);else if ((0, _pendingVisibility.isDiscardedVisible)(s, cutoffMs)) discarded.push(s);
  }

  // 2. Story-group the visible pool (display thresholds incl. the weighted
  //    edge), then attach each discarded copy to at most one of those stories
  //    (`attachToGroups`): a copy joins the card the reader can open it from,
  //    and never folds two cards into one.
  const shownGroups = visible.length > 0 ? (0, _storyGrouping.buildStoryGroups)(visible.map(_storyGrouping.groupableOf), _storyGrouping.DISPLAY_GROUPING_OPTIONS) : [];
  const {
    attachments,
    unattached
  } = (0, _storyGrouping.attachToGroups)(shownGroups, discarded.map(_storyGrouping.groupableOf), _storyGrouping.DISPLAY_GROUPING_OPTIONS);

  // "Discarded by Mera" is every discarded copy no card holds, grouped among
  // themselves, so a below-gate row is behind a card or listed here, never both.
  if (opts.onlyDiscarded) {
    if (unattached.length === 0) return [];
    const list = [];
    for (const g of (0, _storyGrouping.buildStoryGroups)(unattached, _storyGrouping.DISPLAY_GROUPING_OPTIONS)) {
      const rep = (0, _storyGrouping.pickRepresentative)(g, baseRepCompare).s;
      if ((0, _factRowsSelector.isSuggestionOpened)(rep, excludedIds)) continue;
      list.push({
        id: rep.articleId,
        suggestion: rep,
        memberCount: g.length,
        attachedCount: 0,
        memberIds: g.map(m => m.s.articleId),
        breaking: g.some(m => (0, _factRowsSelector.isBreaking)(m.s)),
        score: Math.max(...g.map(m => feedScore(m.s, nowMs)))
      });
    }
    list.sort(feedCompare);
    return list;
  }
  if (shownGroups.length === 0) return [];

  // 3. One representative per group, from its SHOWN members only; drop reps
  //    already excluded (opened ∪ viewed) — the list never re-serves a
  //    read/seen story. Freeze the composite score at build time. An attached
  //    copy is counted and listed, never fronts, and never moves the story.
  const list = [];
  shownGroups.forEach((g, gi) => {
    const attached = attachments[gi];
    const rep = (0, _storyGrouping.pickRepresentative)(g, repCompareForGroups).s;
    if ((0, _factRowsSelector.isSuggestionOpened)(rep, excludedIds)) return;
    list.push({
      id: rep.articleId,
      suggestion: rep,
      memberCount: g.length + attached.length,
      attachedCount: attached.length,
      // articleId, not `_id` — the tombstone/rep-switch keys downstream are
      // compared against future `FeedListItem.id`s, which are article ids.
      // Shown members first, so identity matching tries them before a copy.
      memberIds: [...g, ...attached].map(m => m.s.articleId),
      // Group-maxed for the same reason `score` below is: "breaking" is a
      // property of the STORY, not of whichever member we elected to front it.
      // This became load-bearing when the representative flipped to oldest-first
      // — a story whose originating report was routine but whose later coverage
      // is breaking would otherwise render non-breaking, and lose the feed
      // recency bonus that exists so a breaking story is never buried.
      breaking: g.some(m => (0, _factRowsSelector.isBreaking)(m.s)),
      // A story is scored on its BEST member, not on whichever member was
      // elected to front it. This used to be `feedScore(rep, nowMs)`, which
      // silently coupled two unrelated decisions: because the list is ordered by
      // this score, electing a representative with a lower score DEMOTED the
      // whole story. Preferring a source would therefore have buried that
      // source's own coverage, and the pre-existing geo tier had the same latent
      // bug. A story's importance is a property of the story; which outlet we
      // chose to display is a presentation choice and must not move it.
      score: Math.max(...g.map(m => feedScore(m.s, nowMs)))
    });
  });

  // 4. Deterministic list order.
  list.sort(feedCompare);
  return list;
}