"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useForYouUnscoredCount = exports.useForYouSyncStatusMessage = exports.useForYouSuggestions = exports.useForYouScoringError = exports.useForYouPagination = exports.useForYouLastProcessingRunFinishedAt = exports.useForYouHydrationProgress = exports.useForYouHasGeneratedTopics = exports.useForYouDeviceProcessing = exports.useForYouCounts = exports.useForYouChunkStates = exports.useForYouBatchProgress = exports.useForYouAsyncJobTotalCount = exports.useForYouAsyncJobProcessedCount = exports.useForYouAsyncJobPhase = exports.getForYouActions = void 0;
var _shallow = require("zustand/react/shallow");
var _forYouStore = require("../for-you-store");
/**
 * Optimized selectors for Zustand stores
 *
 * These selectors use shallow equality comparison to prevent unnecessary re-renders
 * when subscribing to multiple state properties.
 *
 * Usage patterns:
 * 1. For single primitive values: use direct selector (no shallow needed)
 *    const suggestions = useForYouStore(state => state.suggestions);
 *
 * 2. For multiple values: use shallow equality
 *    const { endCursor, hasNextPage } = useForYouPagination();
 *
 * 3. For actions: use getState() to avoid re-renders
 *    const actions = useForYouStore.getState();
 *    actions.setSuggestions(data);
 */

// ============================================
// ForYouStore Selectors
// ============================================

/** Get suggestions array (reactive) */
const useForYouSuggestions = () => (0, _forYouStore.useForYouStore)(state => state.suggestions);

/** Get hasGeneratedTopics flag (reactive) */
exports.useForYouSuggestions = useForYouSuggestions;
const useForYouHasGeneratedTopics = () => (0, _forYouStore.useForYouStore)(state => state.hasGeneratedTopics);

/** Get article counts (reactive, shallow equality) */
exports.useForYouHasGeneratedTopics = useForYouHasGeneratedTopics;
const useForYouCounts = () => (0, _forYouStore.useForYouStore)((0, _shallow.useShallow)(state => ({
  articleCount: state.articleCount,
  relevantArticleCount: state.relevantArticleCount
})));

/** Get pagination state (reactive, shallow equality) */
exports.useForYouCounts = useForYouCounts;
const useForYouPagination = () => (0, _forYouStore.useForYouStore)((0, _shallow.useShallow)(state => ({
  endCursor: state.endCursor,
  hasNextPage: state.hasNextPage
})));

/** Get unscored count for mera protocol (reactive) */
exports.useForYouPagination = useForYouPagination;
const useForYouUnscoredCount = () => (0, _forYouStore.useForYouStore)(state => state.unscoredCount);

/** Get device processing state for mera protocol (reactive, shallow equality) */
exports.useForYouUnscoredCount = useForYouUnscoredCount;
const useForYouDeviceProcessing = () => (0, _forYouStore.useForYouStore)((0, _shallow.useShallow)(state => ({
  isDeviceProcessing: state.isDeviceProcessing,
  deviceProcessProgress: state.deviceProcessProgress,
  deviceProcessedCount: state.deviceProcessedCount,
  deviceTotalCount: state.deviceTotalCount
})));

/** Reactive selector for the cloud async-inference phase
 *  ('idle' | 'relevance' | 'reasons'). */
exports.useForYouDeviceProcessing = useForYouDeviceProcessing;
const useForYouAsyncJobPhase = () => (0, _forYouStore.useForYouStore)(state => state.asyncJobPhase);

/** Cumulative number of synced ids the sweep has finished processing
 *  (monotonic across batches). Drives the numerator of the
 *  "Sifting through X/Y" spinner text. */
exports.useForYouAsyncJobPhase = useForYouAsyncJobPhase;
const useForYouAsyncJobProcessedCount = () => (0, _forYouStore.useForYouStore)(state => state.asyncJobProcessedCount);

/** Total synced ids in the current server snapshot. Drives the denominator
 *  of the "Sifting through X/Y" spinner text. */
exports.useForYouAsyncJobProcessedCount = useForYouAsyncJobProcessedCount;
const useForYouAsyncJobTotalCount = () => (0, _forYouStore.useForYouStore)(state => state.asyncJobTotalCount);

/** Reactive selector for the honest cloud batch/article progress.
 *  null when no run is active. Drives the shimmer's "Analysing X of Y articles"
 *  line + the status accordion's progress row. */
exports.useForYouAsyncJobTotalCount = useForYouAsyncJobTotalCount;
const useForYouBatchProgress = () => (0, _forYouStore.useForYouStore)(state => state.batchProgress);

/** Per-batch state for the processing area's chunk strip. null when no run is
 *  active. Counts BATCHES, and `useForYouBatchProgress` counts ARTICLES: both
 *  are true at once and neither is the other's percentage, so never render them
 *  as one ratio. */
exports.useForYouBatchProgress = useForYouBatchProgress;
const useForYouChunkStates = () => (0, _forYouStore.useForYouStore)(state => state.chunkStates);

/** Epoch ms of the last finished processing run (cloud or on-device).
 *  null when no run has ever finished on this device. */
exports.useForYouChunkStates = useForYouChunkStates;
const useForYouLastProcessingRunFinishedAt = () => (0, _forYouStore.useForYouStore)(state => state.lastProcessingRunFinishedAt);

/** Hydration progress for syncFeed's id-by-id chunked fetch
 *  (article-suggestion records pulled from the server). Drives the
 *  per-chunk progress bar in the For You header. Both fields are 0
 *  when no hydration is in flight. */
exports.useForYouLastProcessingRunFinishedAt = useForYouLastProcessingRunFinishedAt;
const useForYouHydrationProgress = () => (0, _forYouStore.useForYouStore)((0, _shallow.useShallow)(state => ({
  hydrationCompleted: state.hydrationCompleted,
  hydrationTotal: state.hydrationTotal
})));

/** Get sync status message (reactive) */
exports.useForYouHydrationProgress = useForYouHydrationProgress;
const useForYouSyncStatusMessage = () => (0, _forYouStore.useForYouStore)(s => s.syncStatusMessage);

/** Cloud scoring pipeline error kind (reactive); null when healthy/idle. */
exports.useForYouSyncStatusMessage = useForYouSyncStatusMessage;
const useForYouScoringError = () => (0, _forYouStore.useForYouStore)(s => s.scoringError);

/** Get all ForYouStore actions (non-reactive, stable references) */
exports.useForYouScoringError = useForYouScoringError;
const getForYouActions = () => {
  const state = _forYouStore.useForYouStore.getState();
  return {
    setSuggestions: state.setSuggestions,
    appendSuggestions: state.appendSuggestions,
    setPagination: state.setPagination,
    setCounts: state.setCounts,
    setHasGeneratedTopics: state.setHasGeneratedTopics,
    setUnscoredCount: state.setUnscoredCount,
    startDeviceProcessing: state.startDeviceProcessing,
    updateDeviceProgress: state.updateDeviceProgress,
    finishDeviceProcessing: state.finishDeviceProcessing,
    clearData: state.clearData,
    setLastSyncAt: state.setLastSyncAt
  };
};

// ============================================
// UserStore Selectors
// ============================================
exports.getForYouActions = getForYouActions;