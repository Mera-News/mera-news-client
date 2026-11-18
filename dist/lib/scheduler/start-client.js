"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.startClient = startClient;
var _hydrateStores = require("../database/hydrate-stores");
var _logger = _interopRequireDefault(require("../logger"));
var _appRestart = require("../app-restart");
var _AppScheduler = require("./AppScheduler");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Boots the client: restart context, scheduler, store hydration, then the scheduler's
 * hydrated kick. Returns the stop function. The host marks itself initialised before calling.
 *
 * `afterHydrate` runs synchronously right before `AppScheduler.onStoresHydrated()`, in the same
 * callback, and is never awaited: host work it starts (model purge, push-token registration) is
 * fire-and-forget, so the kick never waits on it. A synchronous throw skips the kick and is
 * captured like any other bootstrap failure.
 */
function startClient({
  afterHydrate
} = {}) {
  // `cancelled` because `AppScheduler.init()` sits behind an await: a stop in that window must
  // not let init() re-arm its listeners afterwards.
  let cancelled = false;
  void (async () => {
    await (0, _appRestart.initRestartContext)();
    if (cancelled) return;
    void _AppScheduler.AppScheduler.init();
    (0, _hydrateStores.hydrateAllStores)().then(() => {
      afterHydrate?.();
      _AppScheduler.AppScheduler.onStoresHydrated();
    }).catch(error => _logger.default.captureException(error, {
      tags: {
        component: 'RootLayout',
        method: 'bootstrap'
      }
    }));
  })();
  return () => {
    cancelled = true;
    _AppScheduler.AppScheduler.dispose();
  };
}