import { hydrateAllStores } from '@/lib/database/hydrate-stores';
import logger from '@/lib/logger';
import { initRestartContext } from '@/lib/app-restart';
import { AppScheduler } from '@/lib/scheduler/AppScheduler';

/**
 * Boots the client: restart context, scheduler, store hydration, then the scheduler's
 * hydrated kick. Returns the stop function. The host marks itself initialised before calling.
 *
 * `afterHydrate` runs synchronously right before `AppScheduler.onStoresHydrated()`, in the same
 * callback, and is never awaited: host work it starts (model purge, push-token registration) is
 * fire-and-forget, so the kick never waits on it. A synchronous throw skips the kick and is
 * captured like any other bootstrap failure.
 */
export function startClient({ afterHydrate }: { afterHydrate?: () => void } = {}): () => void {
  // `cancelled` because `AppScheduler.init()` sits behind an await: a stop in that window must
  // not let init() re-arm its listeners afterwards.
  let cancelled = false;
  void (async () => {
    await initRestartContext();
    if (cancelled) return;

    void AppScheduler.init();

    hydrateAllStores()
      .then(() => {
        afterHydrate?.();

        AppScheduler.onStoresHydrated();
      })
      .catch((error) =>
        logger.captureException(error, {
          tags: { component: 'RootLayout', method: 'bootstrap' },
        }),
      );
  })();

  return () => { cancelled = true; AppScheduler.dispose(); };
}
