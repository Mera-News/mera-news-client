"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useForYouSuggestionsHydrated = exports.useForYouStore = void 0;
var _zustand = require("zustand");
var _logger = _interopRequireDefault(require("../logger"));
var _articleSuggestionReads = require("../database/services/article-suggestion-reads");
var _articleSuggestionLifecycle = require("../database/services/article-suggestion-lifecycle");
var _articleSuggestionStatus = require("../database/article-suggestion-status");
var _factRowsSelector = require("./fact-rows-selector");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; } // TYPE-ONLY, and that is what makes it safe: scoring-pipeline reaches this
// store through a lazy `require` inside pushUiProgress precisely to avoid a
// load-time cycle, and a type import is erased before any of that runs. It is
// preferred over a second structural copy here (which is what
// `PipelineBatchProgress` below is) because the chunk projection's shape is
// owned by the module that computes it and two copies can only drift.
// The render gate — the single source of truth the pre-filters below are kept
// in lockstep with, rather than a second hardcoded copy of the cutoff. Only a
// type import flows the other way (fact-rows-selector takes `ForYouSuggestion`
// as a type), so this is not a runtime cycle.
//
// `relevancePassesGate`, not `effectiveRenderGate`: the gate is chosen from the
// ROW's scorer vintage, not from the current flag. These counts feed the
// header's "N relevant" sentence, so comparing them against a different gate
// than the feed renders at is exactly the documented incident where the header
// advertised rows the feed then refused to show (see FEED_WINDOW_MS).
/** Article-keyed feed row hydrated from local WatermelonDB. Populated by the
 *  sync service from articlesForTopicsByIds, with client-side scoring fields.
 *
 *  `status` is the pipeline state machine (see article-suggestion-status.ts):
 *  `unscored` (relevance not generated yet; relevance=0, reason=''),
 *  `reason_pending` (scored, reason generating — UI shows loading dots; failed
 *  reason attempts stay here and are retried, with persistent pipeline failures
 *  surfaced as a toast), and `complete` (terminal: reason text present, or
 *  deliberately skipped for a sub-threshold row).
 *
 *  `clusters` is the latest list of clusters the article belongs to, each with
 *  its HDBSCAN membership confidence (0.0–1.0), refreshed every sync
 *  (overwritten unconditionally, including when empty). An article can be in
 *  multiple clusters via `cluster-article-link`. The For-You feed collapses
 *  suggestions into a single representative card via union-find over two edge
 *  types (see `lib/algorithms/story-grouping.ts`): a shared high-confidence
 *  cluster, OR a high title-token Jaccard (the latter bridges the same story
 *  across the server's per-run clustering generations). The detail screen's
 *  "related articles" panel still calls `relatedArticles(articleId)` for the
 *  authoritative live cluster siblings. */

/** One matched topic on a suggestion (parsed from `matched_topics_json`).
 *  `topicId` is null for synthetic headline matches. Consumed by the
 *  fact-sectioned feed selector (`selectSections`). */

/** Honest article-scoring progress for the current cloud run —
 *  `done` articles analysed of `total`. Drives the shimmer's "Analysing X of Y
 *  articles" line + the status accordion's progress row. null when no run is
 *  active. */

/** @deprecated Use syncStatusMessage instead */

const initialState = {
  suggestions: [],
  articleCount: 0,
  relevantArticleCount: 0,
  hasGeneratedTopics: true,
  endCursor: null,
  hasNextPage: true,
  unscoredCount: 0,
  isDeviceProcessing: false,
  deviceProcessProgress: 0,
  deviceProcessedCount: 0,
  deviceTotalCount: 0,
  asyncJobPhase: 'idle',
  asyncJobProcessedCount: 0,
  asyncJobTotalCount: 0,
  batchProgress: null,
  chunkStates: null,
  reasonsInFlightIds: new Set(),
  syncStatusMessage: null,
  lastSyncAt: null,
  scoringError: null,
  laneOutage: {},
  hydrationCompleted: 0,
  hydrationTotal: 0,
  lastProcessingRunFinishedAt: null,
  lastNewArticlesAt: null
};

/**
 * The persisted FeedMetadata, read off the CURRENT state. Every writer calls
 * this after its `set()` instead of building the object by hand: there were
 * eight hand-built copies, and any field one of them forgot was erased from
 * disk by that writer's next call. Adding a persisted field means adding it
 * here and nowhere else.
 */
function metaFromState(state) {
  return {
    articleCount: state.articleCount,
    relevantArticleCount: state.relevantArticleCount,
    hasGeneratedTopics: state.hasGeneratedTopics,
    lastProcessingRunFinishedAt: state.lastProcessingRunFinishedAt,
    lastNewArticlesAt: state.lastNewArticlesAt
  };
}
const useForYouStore = exports.useForYouStore = (0, _zustand.create)()((set, get) => ({
  ...initialState,
  suggestionsHydrated: false,
  setSuggestions: data => {
    set({
      suggestions: data,
      endCursor: null,
      hasNextPage: true
    });
  },
  appendSuggestions: (data, endCursor, hasNextPage) => {
    set(state => ({
      suggestions: [...state.suggestions, ...data],
      endCursor,
      hasNextPage
    }));
  },
  setPagination: (endCursor, hasNextPage) => set({
    endCursor,
    hasNextPage
  }),
  setCounts: (total, relevant) => {
    set({
      articleCount: total,
      relevantArticleCount: relevant
    });
    (0, _articleSuggestionLifecycle.persistFeedMetadata)(metaFromState(get())).catch(err => _logger.default.captureException(err, {
      tags: {
        store: 'for-you-store',
        method: 'setCounts'
      }
    }));
  },
  setHasGeneratedTopics: value => {
    set({
      hasGeneratedTopics: value
    });
    (0, _articleSuggestionLifecycle.persistFeedMetadata)(metaFromState(get())).catch(err => _logger.default.captureException(err, {
      tags: {
        store: 'for-you-store',
        method: 'setHasGeneratedTopics'
      }
    }));
  },
  setUnscoredCount: count => set({
    unscoredCount: count
  }),
  removeSuggestion: serverId => {
    const state = get();
    const target = state.suggestions.find(s => s._id === serverId);
    if (!target) return;
    const nextSuggestions = state.suggestions.filter(s => s._id !== serverId);
    const wasImpactful = target.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Unscored && (0, _factRowsSelector.relevancePassesGate)(target);
    const nextRelevantCount = wasImpactful ? Math.max(0, state.relevantArticleCount - 1) : state.relevantArticleCount;
    set({
      suggestions: nextSuggestions,
      relevantArticleCount: nextRelevantCount
    });
    (0, _articleSuggestionLifecycle.persistFeedMetadata)(metaFromState(get())).catch(err => _logger.default.captureException(err, {
      // Sentry MERA-APP-4W was titled "removeSuggestion", but
      // `removeSuggestion` itself is pure state math and can't throw —
      // the actual failure is always this trailing persistFeedMetadata
      // (WatermelonDB setSetting) write. This tag is what makes that
      // visible instead of merging with every other bare
      // `{ store: 'for-you-store' }` capture in this file into one
      // indistinguishable Sentry issue.
      tags: {
        store: 'for-you-store',
        method: 'removeSuggestion'
      }
    }));
  },
  startDeviceProcessing: total => set({
    isDeviceProcessing: true,
    deviceProcessProgress: 0,
    deviceProcessedCount: 0,
    deviceTotalCount: total
  }),
  updateDeviceProgress: (processed, total) => set(state => {
    const nextTotal = Math.max(state.deviceTotalCount, total ?? 0, processed);
    return {
      deviceProcessedCount: processed,
      deviceTotalCount: nextTotal,
      deviceProcessProgress: nextTotal > 0 ? processed / nextTotal : 0
    };
  }),
  finishDeviceProcessing: () => set(state => ({
    isDeviceProcessing: false,
    deviceProcessProgress: 1,
    deviceProcessedCount: state.deviceTotalCount
  })),
  setAsyncJobPhase: (phase, processedCount, totalCount) => set(state => ({
    asyncJobPhase: phase,
    asyncJobProcessedCount: phase === 'idle' ? 0 : processedCount ?? state.asyncJobProcessedCount,
    asyncJobTotalCount: phase === 'idle' ? 0 : totalCount ?? state.asyncJobTotalCount
  })),
  setAsyncJobProgress: (processedCount, totalCount) => set({
    asyncJobProcessedCount: processedCount,
    asyncJobTotalCount: totalCount
  }),
  setBatchProgress: progress => set({
    batchProgress: progress
  }),
  setChunkStates: states => set({
    chunkStates: states
  }),
  setReasonsInFlightIds: ids => set({
    reasonsInFlightIds: ids
  }),
  setSyncStatusMessage: msg => set({
    syncStatusMessage: msg
  }),
  setLastSyncAt: ts => set({
    lastSyncAt: ts
  }),
  setScoringError: kind => set({
    scoringError: kind
  }),
  setLaneOutage: (lane, info) => set(state => {
    if (!info && !state.laneOutage[lane]) return state;
    const next = {
      ...state.laneOutage
    };
    if (info) next[lane] = state.laneOutage[lane] ?? info;else delete next[lane];
    return {
      laneOutage: next
    };
  }),
  setHydrationProgress: (completed, total) => set({
    hydrationCompleted: completed,
    hydrationTotal: total
  }),
  resetHydrationProgress: () => set({
    hydrationCompleted: 0,
    hydrationTotal: 0
  }),
  markProcessingRunFinished: () => {
    const ts = Date.now();
    set({
      lastProcessingRunFinishedAt: ts
    });
    (0, _articleSuggestionLifecycle.persistFeedMetadata)(metaFromState(get())).catch(err => _logger.default.captureException(err, {
      tags: {
        store: 'for-you-store',
        method: 'markProcessingRunFinished'
      }
    }));
  },
  markNewArticlesArrived: (nowMs = Date.now()) => {
    set({
      lastNewArticlesAt: nowMs
    });
    (0, _articleSuggestionLifecycle.persistFeedMetadata)(metaFromState(get())).catch(err => _logger.default.captureException(err, {
      tags: {
        store: 'for-you-store',
        method: 'markNewArticlesArrived'
      }
    }));
  },
  clearData: async () => {
    // Reset all counts to zero — stale article counts from the previous
    // run are misleading while the DB is empty awaiting the next sync.
    // hasGeneratedTopics is preserved from the current session state
    // because clearing the feed cache does not remove the user's interests.
    const hasGeneratedTopics = get().hasGeneratedTopics;
    set({
      ...initialState,
      hasGeneratedTopics
    });
    try {
      await (0, _articleSuggestionLifecycle.clearSuggestions)();
      await (0, _articleSuggestionLifecycle.persistFeedMetadata)(metaFromState(get()));
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          store: 'for-you-store',
          method: 'clearData'
        }
      });
    }
  },
  pruneOrphanedData: async () => {
    const deletedCount = await (0, _articleSuggestionLifecycle.pruneOrphanedSuggestions)();
    if (deletedCount === -1) {
      // No active topics: full clear. `articleCount` survives: it is the
      // SERVER's 24h published count (FeedSyncMachine's setCounts), not a
      // count of local rows, so clearing the rows says nothing about it.
      const {
        hasGeneratedTopics,
        articleCount
      } = get();
      set({
        ...initialState,
        hasGeneratedTopics,
        articleCount
      });
      await (0, _articleSuggestionLifecycle.persistFeedMetadata)(metaFromState(get())).catch(err => _logger.default.captureException(err, {
        tags: {
          store: 'for-you-store',
          method: 'pruneOrphanedData:fullClear'
        }
      }));
      return;
    }
    if (deletedCount > 0) {
      const rows = await (0, _articleSuggestionReads.loadSuggestions)();
      rows.sort(byRelevanceDesc);
      const relevantCount = rows.filter(s => s.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Unscored && (0, _factRowsSelector.relevancePassesGate)(s)).length;
      // Never `articleCount: rows.length`: that is the server's published
      // count; local rows are a different noun ("0 published" after the
      // 48h prune emptied the Feed).
      set({
        suggestions: rows,
        relevantArticleCount: relevantCount
      });
      await (0, _articleSuggestionLifecycle.persistFeedMetadata)(metaFromState(get())).catch(err => _logger.default.captureException(err, {
        tags: {
          store: 'for-you-store',
          method: 'pruneOrphanedData:reload'
        }
      }));
    }
  },
  hydrateSuggestionsFromDb: async () => {
    try {
      const rows = await (0, _articleSuggestionReads.loadSuggestions)();
      rows.sort(byRelevanceDesc);
      const scoredCount = rows.filter(s => s.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Unscored).length;
      set({
        suggestions: rows,
        unscoredCount: rows.length - scoredCount
      });
    } catch (err) {
      // Hydration failed — leave suggestions empty, but surface the error.
      _logger.default.captureException(err, {
        tags: {
          store: 'for-you-store',
          method: 'hydrateSuggestionsFromDb'
        }
      });
    } finally {
      if (!get().suggestionsHydrated) set({
        suggestionsHydrated: true
      });
    }
  },
  hydrateMetadataFromDb: async () => {
    try {
      // Rehydrate the header's scoring phase/progress from the persisted
      // multi-batch pipeline run (replaces the legacy single-slot
      // getPendingAsyncJob read). idle when no run / all batches terminal.
      const {
        getPipelineUiState,
        getPipelineBatchProgress,
        getPipelineChunkStates,
        getReasonsInFlightIds
      } = await Promise.resolve().then(() => _interopRequireWildcard(require("../services/scoring-pipeline")));
      const [meta, pipelineUi, batchProgress, chunkStates, reasonsInFlightIds] = await Promise.all([(0, _articleSuggestionLifecycle.loadFeedMetadata)(), getPipelineUiState(), getPipelineBatchProgress(), getPipelineChunkStates(),
      // Seeded at boot like the progress fields, so a cold open after
      // a background run shows its pending notes as being written on
      // first paint rather than waiting for the first pipeline push.
      getReasonsInFlightIds()]);
      const current = get().suggestions;
      const impactfulCount = current.filter(s => s.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Unscored && (0, _factRowsSelector.relevancePassesGate)(s)).length;
      set({
        articleCount: meta?.articleCount ?? current.length,
        relevantArticleCount: meta?.relevantArticleCount ?? impactfulCount,
        hasGeneratedTopics: meta?.hasGeneratedTopics ?? true,
        lastProcessingRunFinishedAt: meta?.lastProcessingRunFinishedAt ?? null,
        lastNewArticlesAt: meta?.lastNewArticlesAt ?? null,
        asyncJobPhase: pipelineUi.phase,
        asyncJobProcessedCount: pipelineUi.phase === 'idle' ? 0 : pipelineUi.processedCount,
        asyncJobTotalCount: pipelineUi.phase === 'idle' ? 0 : pipelineUi.totalCount,
        batchProgress: pipelineUi.phase === 'idle' ? null : batchProgress,
        chunkStates: pipelineUi.phase === 'idle' ? null : chunkStates,
        reasonsInFlightIds
      });
    } catch (err) {
      // Metadata hydration failed — leave defaults in place, but surface the error.
      _logger.default.captureException(err, {
        tags: {
          store: 'for-you-store',
          method: 'hydrateMetadataFromDb'
        }
      });
    }
  }
}));

/** Whether the first local read of suggestions has finished (reactive). */
const useForYouSuggestionsHydrated = () => useForYouStore(s => s.suggestionsHydrated);
exports.useForYouSuggestionsHydrated = useForYouSuggestionsHydrated;
function byRelevanceDesc(a, b) {
  const av = a.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Unscored ? a.relevance : -Infinity;
  const bv = b.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Unscored ? b.relevance : -Infinity;
  return bv - av;
}