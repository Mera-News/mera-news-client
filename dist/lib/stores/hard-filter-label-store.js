"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useHardFilterLabel = useHardFilterLabel;
exports.useHardFilterLabelStore = void 0;
var _zustand = require("zustand");
// hard-filter-label-store — which cards on screen are "you filtered this, but
// it's major news", and which filter did it.
//
// The headline exemption spares TOP-HEADLINE rows from hard "not interested" exclusion: a filter is
// about routine coverage, not about hiding major news, so such a row is demoted
// (scoring-engine/relevance.ts) instead of removed. A blocked subject appearing
// with NO explanation is worse than the feature not existing — so every exempt
// card must be labelled, and this store is what the card reads.
//
// DERIVED, NOT PERSISTED. The map is recomputed from the live filters + the
// stored rows on every suggestion-store refresh
// (`SuggestionSyncService.refreshSuggestionsInStore` →
// `suppression-sweep.refreshHardFilterLabels`). That is deliberate:
//
//  • It cannot drift from the matcher — it IS the matcher
//    (`screenHardSuppressionsDetailed`) over the same rehydrated
//    `ScoredCandidateInput` the scoring stage screens, so it never under-labels
//    the way a partial re-match against the trimmed store row would (that row
//    carries no entities/geoTags/category, so `entity`/`place`/`category`
//    filters would silently go unlabelled — exactly the surprise this closes).
//  • Retiring a filter clears its labels for free on the next refresh; nothing
//    has to remember to clean up.
//  • A cold launch labels correctly with no migration and no stored column —
//    the first refresh rebuilds the whole map.
//
// Keyed by article-suggestion id (the same id `card-${suggestion._id}` uses).

/** Referentially stable empty map, so `setLabels({})` on an already-empty store
 *  can bail out without notifying subscribers (see below). */
const EMPTY = {};
const useHardFilterLabelStore = exports.useHardFilterLabelStore = (0, _zustand.create)((set, get) => ({
  labels: EMPTY,
  setLabels: labels => {
    const prev = get().labels;
    const nextKeys = Object.keys(labels);
    // No-op guard: the common path is "no hard filters ⇒ empty map, every
    // refresh". Re-setting a new empty object each time would re-render every
    // card that subscribes here for nothing.
    if (nextKeys.length === 0) {
      if (Object.keys(prev).length === 0) return;
      set({
        labels: EMPTY
      });
      return;
    }
    if (nextKeys.length === Object.keys(prev).length && nextKeys.every(k => prev[k] === labels[k])) {
      return;
    }
    set({
      labels
    });
  },
  clear: () => set({
    labels: EMPTY
  })
}));

/**
 * The card-facing selector hook: the filter display value for this suggestion,
 * or null when it is not a filtered-but-shown row.
 *
 * Selecting the single string (not the map) keeps the `React.memo` card from
 * re-rendering when some OTHER card's label changes.
 */
function useHardFilterLabel(suggestionId) {
  return useHardFilterLabelStore(s => s.labels[suggestionId] ?? null);
}