"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toastManager = void 0;
var _index = require("./index");
// Stands in for the app's lib/toast-manager (the notified toast only). The inbox row is the
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
      } = await import("../database/services/notification-service");
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