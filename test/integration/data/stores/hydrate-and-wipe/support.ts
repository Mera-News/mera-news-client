// Shared by the hydrate-and-wipe seam tests: a reset of the module memory a per-test DB reset
// does not touch, and the shared fault and polling helpers (support/faults). Not a test file.
import { __clearPublisherSourceNames } from '@/lib/database/services/publisher-source-names';
import { resetReadHold } from '@/lib/subscription/read-hold';
import { useAppLanguageStore } from '@/lib/stores/app-language-store';
import { useAppStateStore } from '@/lib/stores/app-state-store';
import { useBlurImagesStore } from '@/lib/stores/blur-images-store';
import { useDatabaseStore } from '@/lib/stores/database-store';
import { useForYouPrefsStore } from '@/lib/stores/for-you-prefs-store';
import { useForYouStore } from '@/lib/stores/for-you-store';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
import { useOnboardingStore } from '@/lib/stores/onboarding-store';
import { useRelatedSortStore } from '@/lib/stores/related-sort-store';
import { useTutorialsStore } from '@/lib/stores/tutorials-store';
import { useUserStore } from '@/lib/stores/user-store';

// ---------------------------------------------------------------------------
// Module memory
// ---------------------------------------------------------------------------

const hydratedStores = [
  useForYouStore,
  useUserStore,
  useMeraProtocolStore,
  useOnboardingStore,
  useAppLanguageStore,
  useAppStateStore,
  useForYouPrefsStore,
  useBlurImagesStore,
  useRelatedSortStore,
  useTutorialsStore,
  useDatabaseStore,
];

/**
 * Back to a cold start: the per-test setup resets storage and the DB but not the
 * memory that mirrors them. setState(initial, true) rather than each store's
 * reset()/clearUser(), because several of those also fire DB deletes that would
 * land in the next test.
 */
export function resetHydrationMemory(): void {
  __clearPublisherSourceNames();
  resetReadHold();
  for (const store of hydratedStores) {
    (store as unknown as { setState(s: unknown, replace: true): void }).setState(
      (store as unknown as { getInitialState(): unknown }).getInitialState(),
      true,
    );
  }
}

export { failSettingRead, holdSettingRead, failTableQuery, holdTableQuery, restoreFaults, until, flush } from '../../support/faults';
