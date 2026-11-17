// Stands in for the app's lib/toast-manager (the notified toast only). The inbox row is the
// package's own: it is written here, then the host shows its toast for that row. A host without
// toasts keeps the row and shows nothing.
import { platform, type NotifiedToastOptions } from './index';

export type { NotifiedToastOptions } from './index';

export const toastManager = {
  async showNotifiedToast(opts: NotifiedToastOptions): Promise<void> {
    // 1. Persist the row (raw keys). Loaded lazily so this folder never imports the database while
    // it loads. Failure is non-fatal.
    let row: unknown = null;
    try {
      const { notify } = await import('@/lib/database/services/notification-service');
      row = await notify({
        type: opts.type,
        title: opts.title,
        body: opts.body,
        icon: opts.icon ?? null,
        context: opts.context ?? null,
        actions: opts.actions ?? null,
        source: opts.source,
        dedupeDaily: opts.dedupeDaily,
        replaces: opts.replaces,
      });
    } catch (err) {
      const logger = (require('@/lib/logger') as typeof import('@/lib/logger')).default;
      logger.captureException(err, {
        tags: { component: 'ToastManager', method: 'showNotifiedToast.notify' },
      });
    }

    // 2. The host's toast for the row, shown even when the write failed.
    platform('toast').showNotifiedToast?.(row, opts);
  },
};
