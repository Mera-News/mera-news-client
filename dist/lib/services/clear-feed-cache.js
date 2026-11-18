"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clearFeedCacheAndResync = clearFeedCacheAndResync;
var _AppScheduler = require("../scheduler/AppScheduler");
var _schedulerStore = require("../scheduler/scheduler-store");
var scoringPipeline = _interopRequireWildcard(require("./scoring-pipeline"));
var _stores = require("../stores");
var _feedOrderStore = require("../stores/feed-order-store");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
// Clears the on-device feed cache (every article suggestion, its fact links and
// the feed's counts) and starts a fresh sync. Facts, topics and settings stay.
//
// The order is load-bearing:
// - clearData first: it deletes the suggestion rows and resets the For You store.
// - the persisted feed order points at the deleted rows, so it is reset.
// - the scoring run is aborted AFTER clearData (clearData nulls the finished stamp the
//   abort writes) and BEFORE the sync, or its orphaned batches keep the pipeline
//   reading 'running' and every feed sync bails (the clear-feed deadlock).

async function clearFeedCacheAndResync() {
  await _stores.useForYouStore.getState().clearData();
  _feedOrderStore.useFeedOrderStore.getState().reset();
  await scoringPipeline.abortRun('cache-clear');
  if (!_schedulerStore.useSchedulerStore.getState().isRunning('feed-sync')) {
    void _AppScheduler.AppScheduler.trigger('feed-sync');
  }
}