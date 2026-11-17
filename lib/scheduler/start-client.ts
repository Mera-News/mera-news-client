import { hydrateAllStores } from '@/lib/database/hydrate-stores';
import logger from '@/lib/logger';
import { initRestartContext } from '@/lib/app-restart';
import { AppScheduler } from '@/lib/scheduler/AppScheduler';

export function startClient({ afterHydrate }: { afterHydrate?: () => void | Promise<void> } = {}): () => void {
  let cancelled = false;
  void (async () => {
    await initRestartContext();
    if (cancelled) return;

    void AppScheduler.init();

    hydrateAllStores()
      .then(async () => {
        await afterHydrate?.();

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
