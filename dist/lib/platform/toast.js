"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toastManager = void 0;
var _index = require("./index");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; } // Stands in for the app's lib/toast-manager (the notified toast only). The inbox row is the
// package's own: it is written here, then the host shows its toast for that row. A host without
// toasts keeps the row and shows nothing.
const toastManager = exports.toastManager = {
  async showNotifiedToast(opts) {
    // 1. Persist the row (raw keys). Loaded lazily so this folder never imports the database while
    // it loads. Failure is non-fatal.
    let row = null;
    try {
      const {
        notify
      } = await Promise.resolve().then(() => _interopRequireWildcard(require("../database/services/notification-service")));
      row = await notify({
        type: opts.type,
        title: opts.title,
        body: opts.body,
        icon: opts.icon ?? null,
        context: opts.context ?? null,
        actions: opts.actions ?? null,
        source: opts.source,
        dedupeDaily: opts.dedupeDaily,
        replaces: opts.replaces
      });
    } catch (err) {
      const logger = require("../logger").default;
      logger.captureException(err, {
        tags: {
          component: 'ToastManager',
          method: 'showNotifiedToast.notify'
        }
      });
    }

    // 2. The host's toast for the row, shown even when the write failed.
    (0, _index.platform)('toast').showNotifiedToast?.(row, opts);
  }
};