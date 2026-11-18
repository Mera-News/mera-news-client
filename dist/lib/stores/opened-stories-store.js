"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useOpenedStoriesStore = void 0;
var _zustand = require("zustand");
var _storyImpressionService = require("../database/services/story-impression-service");
var _logger = _interopRequireDefault(require("../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// opened-stories-store — the in-memory OPENS-ONLY seen set for the two-zone
// feed's dimming affordance. Mirrors `story-impression-service.getOpenedSeenSet`
// (article_id ∪ non-null stable_cluster_id of OPENED rows) but keeps a live copy
// so the feed can dim an "Earlier" row the instant the user opens it, without
// waiting for a DB round-trip. The DB row is still written by the open handler;
// this store is the optimistic read-through mirror.

const useOpenedStoriesStore = exports.useOpenedStoriesStore = (0, _zustand.create)((set, get) => ({
  ids: new Set(),
  articleIds: new Set(),
  hydrated: false,
  hydrate: async () => {
    try {
      const {
        articleIds,
        clusterIds
      } = await (0, _storyImpressionService.getOpenedSeenBreakdown)();
      // Merge, don't replace — an optimistic markOpened() may have landed while
      // the DB read was in flight; that add must not be lost.
      const mergedIds = new Set([...articleIds, ...clusterIds]);
      for (const id of get().ids) mergedIds.add(id);
      const mergedArticleIds = new Set(articleIds);
      for (const id of get().articleIds) mergedArticleIds.add(id);
      set({
        ids: mergedIds,
        articleIds: mergedArticleIds,
        hydrated: true
      });
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          store: 'opened-stories-store'
        }
      });
      set({
        hydrated: true
      });
    }
  },
  markOpened: (articleId, stableClusterId) => {
    const next = new Set(get().ids);
    if (articleId) next.add(articleId);
    if (stableClusterId) next.add(stableClusterId);
    const nextArticleIds = articleId ? new Set(get().articleIds).add(articleId) : get().articleIds;
    set({
      ids: next,
      articleIds: nextArticleIds
    });
  },
  clear: () => set({
    ids: new Set(),
    articleIds: new Set()
  })
}));