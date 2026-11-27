"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SAMPLE_TITLE_MAX = exports.SAMPLE_LIMIT = void 0;
exports.computeFeedFunnel = computeFeedFunnel;
exports.feedFunnelScalars = feedFunnelScalars;
var _factRowsSelector = require("./fact-rows-selector");
var _feedListSelector = require("./feed-list-selector");
var _storyGrouping = require("../algorithms/story-grouping");
var _grayBandPairs = require("../algorithms/gray-band-pairs");
var _feedEntries = require("../feed-ordering/feed-entries");
// feed-diagnostics — an ON-DEMAND explanation of "why is my For you feed
// showing N cards". Answers the question the raw counts cannot: the header says
// 79 relevant articles and the feed shows 3, and almost all of that gap is
// legitimate (`reason_pending` rows, and story grouping
// collapsing many articles into one card) — but some of it may not be.
//
// PURE + RN-FREE, same invariant as feed-list-selector. It takes every input as
// an argument and imports no DB / expo / react-native module. In particular it
// must NEVER import feed-order-store: that pulls in the settings service and
// through it `lib/database/index.ts`, which instantiates a SQLite adapter at
// module load. Store state arrives here as plain data.
//
// COST: computed only when the Observability screen refreshes. It is not on the
// render, ingest, or scroll path, and nothing on those paths imports this file.
//
// It reuses the real predicates (`isVisible`'s sub-gates, `isOpenedId`,
// `buildFeedList`, `resolveExistingOrderId`) rather than re-implementing them,
// so it cannot drift from the pipeline it describes. Where it must replicate
// control flow — `ingest`'s two-pass claim — that is called out inline as a
// paired edit.

/** Max per-article rows in each `samples` array. Share payload only. */
const SAMPLE_LIMIT = exports.SAMPLE_LIMIT = 25;
/** Sample titles are truncated to keep the share payload readable. */
const SAMPLE_TITLE_MAX = exports.SAMPLE_TITLE_MAX = 120;

/** Why a suggestion never reached the visible pool. EXCLUSIVE: the first
 *  failure in this exact order wins, mirroring `isVisible`'s conjunction, so
 *  `dropped.* + visibleCount === totals.rows`. */

/** Not a failure at all — the row rendered. Exists so the `visible` sample
 *  array can reuse `FeedFunnelSample` rather than growing a near-duplicate
 *  shape whose only difference is the missing reason. */

/** Why a candidate story has no exact-id entry in the persisted order.
 *  EXCLUSIVE, in the same precedence `feed-order-store.ingest` applies. */

/** Bounded per-article detail. SHARE PAYLOAD ONLY — never Sentry-bound, see
 *  the note on `feedFunnelScalars`. */

function parseMs(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}
function ageHours(s, nowMs) {
  const pub = parseMs(s.firstPubDate);
  if (pub === 0) return -1;
  return Math.round((nowMs - pub) / 3_600_000 * 10) / 10;
}
function makeSample(s, reason, nowMs, memberCount = null, matchedKey = null) {
  const title = s.title_en ?? s.title_original ?? '';
  const note = s.reason ?? '';
  return {
    suggestionId: s._id,
    articleId: s.articleId,
    title: title.length > SAMPLE_TITLE_MAX ? `${title.slice(0, SAMPLE_TITLE_MAX)}…` : title,
    status: String(s.status),
    relevance: s.relevance ?? 0,
    ageHours: ageHours(s, nowMs),
    memberCount,
    note: note.length > SAMPLE_TITLE_MAX ? `${note.slice(0, SAMPLE_TITLE_MAX)}…` : note,
    reason,
    matchedKey
  };
}

/** Total order so a re-run on shuffled input yields identical samples. */
function bySuggestionRecency(a, b) {
  if (a.ageHours !== b.ageHours) return a.ageHours - b.ageHours;
  return a.suggestionId < b.suggestionId ? -1 : a.suggestionId > b.suggestionId ? 1 : 0;
}
function computeFeedFunnel(input) {
  const {
    nowMs
  } = input;
  const modes = input.scoringModes ?? null;
  const shared = input.sharedNotes ?? null;
  const cutoffMs = nowMs - _factRowsSelector.FEED_WINDOW_MS;

  // ── Stage 1: visibility, with exclusive reason attribution ────────────────
  const status = {
    unscored: 0,
    reasonPending: 0,
    complete: 0,
    excluded: 0,
    other: 0
  };
  const failing = {
    notComplete: 0,
    belowRelevanceGate: 0,
    outsideWindow: 0
  };
  const dropped = {
    excluded: 0,
    notComplete: 0,
    belowRelevanceGate: 0,
    outsideWindow: 0,
    unknownGate: 0
  };
  const droppedSamples = [];
  // The rows that rendered. Every other sample array in this report explains an
  // ABSENCE, which is the right question when the feed is empty — but the
  // question here is about a card the user is looking at, and nothing in the
  // report could previously show one.
  const visibleSamples = [];
  let visibleCount = 0;
  for (const s of input.suggestions) {
    const st = String(s.status);
    if (st === 'unscored') status.unscored++;else if (st === 'reason_pending') status.reasonPending++;else if (st === 'complete') status.complete++;else if (st === 'excluded') status.excluded++;else status.other++;
    if ((0, _factRowsSelector.isVisible)(s, cutoffMs)) {
      visibleCount++;
      visibleSamples.push(makeSample(s, 'visible', nowMs));
      continue;
    }
    const okStatus = (0, _factRowsSelector.isComplete)(s);
    const okRelevance = (0, _factRowsSelector.passesRenderGate)(s);
    const okWindow = (0, _factRowsSelector.isWithinWindow)(s, cutoffMs);
    if (!okStatus) failing.notComplete++;
    if (!okRelevance) failing.belowRelevanceGate++;
    if (!okWindow) failing.outsideWindow++;
    const reason = st === 'excluded' ? 'excluded' : !okStatus ? 'not-complete' : !okRelevance ? 'below-relevance-gate' : !okWindow ? 'outside-window' : 'unknown-gate';
    dropped[reason === 'excluded' ? 'excluded' : reason === 'not-complete' ? 'notComplete' : reason === 'below-relevance-gate' ? 'belowRelevanceGate' : reason === 'outside-window' ? 'outsideWindow' : 'unknownGate']++;
    droppedSamples.push(makeSample(s, reason, nowMs));
  }

  // ── Stages 2-3: grouping + representative election ────────────────────────
  // Reuse buildFeedList rather than re-running buildStoryGroups. With an empty
  // exclusion set it emits exactly one item per group, so `candidates.length`
  // IS the group count and Σ memberCount must equal visibleCount.
  const candidates = (0, _feedListSelector.buildFeedList)(input.suggestions, new Set(), nowMs, input.userCtx);
  let memberSum = 0;
  let largestSize = 0;
  let breakingCount = 0;
  let topScore = null;
  let lowestScore = null;
  for (const c of candidates) {
    memberSum += c.memberCount;
    if (c.memberCount > largestSize) largestSize = c.memberCount;
    if (c.breaking) breakingCount++;
    if (topScore === null || c.score > topScore) topScore = c.score;
    if (lowestScore === null || c.score < lowestScore) lowestScore = c.score;
  }

  // ── Stage 4: order membership, replicating ingest's two-pass claim ────────
  // PAIRED EDIT: this mirrors `feed-order-store.ingest`. Building the identity
  // map over ALL of itemsById (rather than only unclaimed rows) would report
  // `represented-under-other-id` for split-off siblings that ingest actually
  // treats as genuinely-new cards.
  const inOrder = new Set(input.order);
  const claimed = new Set();
  const pending = [];
  for (const c of candidates) {
    if (inOrder.has(c.id)) claimed.add(c.id);else pending.push(c);
  }
  const identityToOrderId = new Map();
  for (const id of input.order) {
    if (claimed.has(id)) continue;
    const existing = input.itemsById[id];
    if (!existing) continue;
    const scid = (0, _feedListSelector.stableClusterIdOf)(existing);
    if (scid) identityToOrderId.set(scid, id);
    for (const mid of existing.memberIds ?? []) identityToOrderId.set(mid, id);
  }
  const byReason = {
    'represented-under-other-id': 0,
    'opened-by-article-id': 0,
    'duplicate-candidate-id': 0,
    'not-yet-ingested': 0
  };
  const missingSamples = [];
  const seenNew = new Set();
  let wouldBeBlockedByClusterGate = 0;
  for (const c of pending) {
    const oldId = (0, _feedListSelector.resolveExistingOrderId)(c, identityToOrderId);
    if (oldId && !claimed.has(oldId)) {
      claimed.add(oldId);
      byReason['represented-under-other-id']++;
      continue; // the story IS in the feed — deliberately not sampled
    }
    const articleId = c.suggestion.articleId;
    if (articleId && input.openedArticleIds.has(articleId)) {
      byReason['opened-by-article-id']++;
      missingSamples.push(makeSample(c.suggestion, 'opened-by-article-id', nowMs, c.memberCount, articleId));
      continue;
    }

    // Counterfactual: this candidate IS in the feed, but the old cluster-wide
    // union gate would have dropped it. Measured after the live gate so it only
    // counts cards the narrowing actually rescued.
    const scid = (0, _feedListSelector.stableClusterIdOf)(c);
    if ((0, _factRowsSelector.isOpenedId)(null, scid, input.openedUnionIds)) wouldBeBlockedByClusterGate++;
    if (seenNew.has(c.id)) {
      byReason['duplicate-candidate-id']++;
      missingSamples.push(makeSample(c.suggestion, 'duplicate-candidate-id', nowMs, c.memberCount));
      continue;
    }
    seenNew.add(c.id);
    byReason['not-yet-ingested']++;
    missingSamples.push(makeSample(c.suggestion, 'not-yet-ingested', nowMs, c.memberCount));
  }
  const notInOrderTotal = byReason['represented-under-other-id'] + byReason['opened-by-article-id'] + byReason['duplicate-candidate-id'] + byReason['not-yet-ingested'];

  // ── Order + card-state tallies ────────────────────────────────────────────
  let renderedCount = 0;
  let orphanCount = 0;
  for (const id of input.order) {
    if (input.itemsById[id]) renderedCount++;else orphanCount++;
  }
  let skipped = 0;
  let viewed = 0;
  let staleEntries = 0;
  for (const [id, rec] of Object.entries(input.cardStates)) {
    if (!inOrder.has(id)) {
      staleEntries++;
      continue;
    }
    if (rec.state === 'viewed') viewed++;else skipped++;
  }

  // Divider position, derived rather than passed in: it is exactly the count of
  // RENDERED rows that are not yet seen. Mirrors `isSeenEntry` in
  // components/custom/feed/feed-entries.ts — kept as a local expression rather
  // than importing a component module into lib/stores.
  let aboveDividerCount = 0;
  for (const id of input.order) {
    const it = input.itemsById[id];
    if (!it) continue;
    const seen = !!input.cardStates[id] || !!it.suggestion.articleId && input.openedArticleIds.has(it.suggestion.articleId);
    if (!seen) aboveDividerCount++;
  }
  const dividerIndex = aboveDividerCount;
  const belowDividerCount = Math.max(0, renderedCount - aboveDividerCount);

  // ── Residual duplicate candidates (counters only) ─────────────────────────
  // Run over the WHOLE pool, not the visible subset: the question this counter
  // was built to answer is what a PRE-SCORING dedup step would have to chew on,
  // and scoring sees the pool. Cost is one popcount sweep over ~10²–10³ items,
  // on the Observability refresh path only.
  const sidecars = input.vectorSidecarsById;
  const dedupItems = input.suggestions.map(s => ({
    ...(0, _storyGrouping.groupableOf)(s),
    vectorSidecarPacked: sidecars ? sidecars[s.articleId] ?? null : null
  }));
  const {
    counters: dedup
  } = (0, _grayBandPairs.grayBandSweep)(dedupItems);
  const memberSumMatchesVisible = memberSum === visibleCount;
  const visibilityAttributionSums = dropped.excluded + dropped.notComplete + dropped.belowRelevanceGate + dropped.outsideWindow + dropped.unknownGate + visibleCount === input.suggestions.length;
  let layout = null;
  if (input.algo) {
    const data = input.order.map(id => input.itemsById[id]).filter(it => !!it);
    const l = (0, _feedEntries.layoutFeed)({
      data,
      cardStates: input.cardStates,
      openedArticleIds: input.openedArticleIds,
      nowMs,
      pin: _feedEntries.EMPTY_PIN,
      tail: [],
      show: 'all',
      ready: true,
      ctx: input.userCtx,
      algo: input.algo
    });
    layout = {
      above: l.above.length,
      below: l.below.length,
      belowSeen: l.belowSeen,
      terminal: l.terminal
    };
  }
  return {
    generatedAtMs: nowMs,
    hydrated: {
      order: input.orderHydrated,
      opened: input.openedHydrated
    },
    layout,
    gates: {
      renderGate: (0, _factRowsSelector.effectiveRenderGate)(),
      mixedVintage: {
        legacyGate: _factRowsSelector.RENDER_GATE,
        v3Gate: _factRowsSelector.V3_RENDER_GATE,
        v3ScoredRows: input.suggestions.filter(s => s.scoredWithV3 === true).length,
        legacyScoredRows: input.suggestions.filter(s => s.scoredWithV3 !== true).length
      },
      renderWindowMs: _factRowsSelector.FEED_WINDOW_MS,
      renderCutoffMs: cutoffMs
    },
    totals: {
      rows: input.suggestions.length,
      status
    },
    failing,
    dropped,
    visibleCount,
    header: {
      analysedCount: input.headerAnalysedCount,
      relevantCount: input.headerRelevantCount,
      relevantMinusVisible: input.headerRelevantCount - visibleCount
    },
    groups: {
      count: candidates.length,
      largestSize,
      memberSum,
      memberSumMatchesVisible,
      collapseRatio: candidates.length > 0 ? Math.round(visibleCount / candidates.length * 100) / 100 : 0
    },
    candidates: {
      count: candidates.length,
      breakingCount,
      topScore: topScore === null ? null : Math.round(topScore * 1000) / 1000,
      lowestScore: lowestScore === null ? null : Math.round(lowestScore * 1000) / 1000
    },
    orderStage: {
      builtAtMs: input.builtAt,
      length: input.order.length,
      renderedCount,
      orphanCount,
      dividerIndex,
      aboveDividerCount,
      belowDividerCount
    },
    cardStates: {
      skipped,
      viewed,
      unviewed: Math.max(0, input.order.length - skipped - viewed),
      staleEntries
    },
    candidatesNotInOrder: {
      total: notInOrderTotal,
      absent: notInOrderTotal - byReason['represented-under-other-id'],
      byReason
    },
    wouldBeBlockedByClusterGate,
    opened: {
      articleIdSetSize: input.openedArticleIds.size,
      unionSetSize: input.openedUnionIds.size,
      storeMinusDb: input.openedStats === null ? null : input.openedUnionIds.size - input.openedStats.unionSize,
      stats: input.openedStats
    },
    scoring: {
      math: modes?.math ?? 0,
      legacy: modes?.backstop ?? 0,
      unknown: modes?.unknown ?? 0,
      scoredRows: modes ? modes.math + modes.backstop + modes.unknown : 0,
      available: modes != null
    },
    sharedNotes: {
      rowsWithNote: shared?.rowsWithNote ?? 0,
      distinctNotes: shared?.distinctNotes ?? 0,
      sharedNoteGroups: shared?.sharedNoteGroups ?? 0,
      rowsSharingANote: shared?.rowsSharingANote ?? 0,
      largestGroupSize: shared?.largestGroupSize ?? 0,
      largestGroup: shared?.largestGroup ?? null,
      available: shared != null
    },
    dedup,
    hydrateProvenance: input.hydrateStats,
    launchWipeSuspected: !!input.hydrateStats?.emptyPoolGuardTripped,
    sumsCheck: {
      visibilityAttributionSums,
      memberSumMatchesVisible,
      orderReasonsSum: notInOrderTotal === pending.length
    },
    samples: {
      // Highest-scoring first: a note that misdescribes its article is most
      // damaging on the cards that rank highest, and those are the ones the
      // reader actually saw.
      visible: visibleSamples.sort((a, b) => b.relevance - a.relevance || bySuggestionRecency(a, b)).slice(0, SAMPLE_LIMIT),
      droppedBeforeVisible: droppedSamples.sort(bySuggestionRecency).slice(0, SAMPLE_LIMIT),
      missingFromOrder: missingSamples.sort(bySuggestionRecency).slice(0, SAMPLE_LIMIT)
    }
  };
}

/**
 * Flat projection: every value is a number | boolean | short string.
 *
 * This is the ONLY shape that may ever be Sentry-bound. `capStringValues` in
 * lib/sentry-init.ts recurses plain objects but deliberately skips ARRAYS, so
 * putting `report.samples` into `event.extra` would smuggle untruncated article
 * titles past the 200-char PII redaction. Keep this array-free and object-free.
 */
function feedFunnelScalars(r) {
  return {
    rows: r.totals.rows,
    statusUnscored: r.totals.status.unscored,
    statusReasonPending: r.totals.status.reasonPending,
    statusComplete: r.totals.status.complete,
    statusExcluded: r.totals.status.excluded,
    visible: r.visibleCount,
    droppedExcluded: r.dropped.excluded,
    droppedNotComplete: r.dropped.notComplete,
    droppedBelowGate: r.dropped.belowRelevanceGate,
    droppedOutsideWindow: r.dropped.outsideWindow,
    droppedUnknownGate: r.dropped.unknownGate,
    headerRelevant: r.header.relevantCount,
    headerRelevantMinusVisible: r.header.relevantMinusVisible,
    groups: r.groups.count,
    collapseRatio: r.groups.collapseRatio,
    largestGroup: r.groups.largestSize,
    candidates: r.candidates.count,
    orderLength: r.orderStage.length,
    rendered: r.orderStage.renderedCount,
    orphans: r.orderStage.orphanCount,
    aboveDivider: r.orderStage.aboveDividerCount ?? -1,
    belowDivider: r.orderStage.belowDividerCount ?? -1,
    skipped: r.cardStates.skipped,
    viewed: r.cardStates.viewed,
    unviewed: r.cardStates.unviewed,
    staleCardStates: r.cardStates.staleEntries,
    missingFromOrder: r.candidatesNotInOrder.absent,
    missingOpenedByArticleId: r.candidatesNotInOrder.byReason['opened-by-article-id'],
    missingNotYetIngested: r.candidatesNotInOrder.byReason['not-yet-ingested'],
    wouldBeBlockedByClusterGate: r.wouldBeBlockedByClusterGate,
    openedArticleIds: r.opened.articleIdSetSize,
    openedUnionIds: r.opened.unionSetSize,
    openedRows: r.opened.stats?.rowCount ?? -1,
    openedOlderThan7d: r.opened.stats?.ageBuckets.d7to30 ?? -1,
    // Which scorer ran. `-1` (not 0) when the breakdown was unavailable, the
    // same "this is not a measurement" convention the opened fields use above.
    scoredByMath: r.scoring.available ? r.scoring.math : -1,
    scoredByLlm: r.scoring.available ? r.scoring.legacy : -1,
    scoredByUnknown: r.scoring.available ? r.scoring.unknown : -1,
    // Shared-note COUNTS only. `largestGroup` carries a note and article titles
    // and must never come along — see the array/object prohibition above.
    sharedNoteGroups: r.sharedNotes.available ? r.sharedNotes.sharedNoteGroups : -1,
    rowsSharingANote: r.sharedNotes.available ? r.sharedNotes.rowsSharingANote : -1,
    largestSharedNoteGroup: r.sharedNotes.available ? r.sharedNotes.largestGroupSize : -1,
    // Residual duplicate candidates. Counts only — the pairs themselves carry
    // article ids and never leave the report object.
    dedupCandidates: r.dedup.dedupCandidates,
    dedupWithSidecar: r.dedup.dedupWithSidecar,
    dedupPairsSent: r.dedup.dedupPairsSent,
    dedupPairsFound: r.dedup.dedupPairsFound,
    dedupPairsVectorAxis: r.dedup.dedupPairsVectorAxis,
    dedupPairsLexicalAxis: r.dedup.dedupPairsLexicalAxis,
    dedupClosestHamming: r.dedup.dedupClosestHamming,
    orderHydrated: r.hydrated.order,
    openedHydrated: r.hydrated.opened,
    launchWipeSuspected: r.launchWipeSuspected,
    sumsOk: r.sumsCheck.visibilityAttributionSums && r.sumsCheck.memberSumMatchesVisible && r.sumsCheck.orderReasonsSum
  };
}