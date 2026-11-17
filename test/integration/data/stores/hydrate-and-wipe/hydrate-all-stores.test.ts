// hydrateAllStores against the real stores, the in-memory WatermelonDB and MSW.
import database from '@/lib/database';
import { hydrateAllStores } from '@/lib/database/hydrate-stores';
import { persistUserPersona } from '@/lib/database/services/user-persona-service';
import { recordPublicationVisit } from '@/lib/database/services/publication-visit-service';
import { setSetting } from '@/lib/database/services/setting-service';
import {
  PUBLISHER_SOURCE_NAMES_SETTING,
  knownSourceNamesForPublisher,
} from '@/lib/database/services/publisher-source-names';
import { getReadHold, isReadHeld, resetReadHold, setReadHold } from '@/lib/subscription/read-hold';
import { useAppLanguageStore } from '@/lib/stores/app-language-store';
import { useAppStateStore } from '@/lib/stores/app-state-store';
import { useBlurImagesStore } from '@/lib/stores/blur-images-store';
import { useDatabaseStore } from '@/lib/stores/database-store';
import { useForYouPrefsStore } from '@/lib/stores/for-you-prefs-store';
import { useForYouStore } from '@/lib/stores/for-you-store';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
import { useOnboardingStore } from '@/lib/stores/onboarding-store';
import { usePublicationDisplayStore } from '@/lib/stores/publication-display-store';
import { useRelatedSortStore } from '@/lib/stores/related-sort-store';
import { chapterCompletedKey, useTutorialsStore } from '@/lib/stores/tutorials-store';
import { useUserStore } from '@/lib/stores/user-store';
import { OnboardingStage, ProcessingMode } from '@/lib/generated/graphql-types';
import type { UserPersona } from '@/lib/account-service';
import { mockGql, server, useFakeClock as freezeClockAt } from '@/test/helpers';
import {
  failSettingRead,
  failTableQuery,
  flush,
  holdSettingRead,
  holdTableQuery,
  resetHydrationMemory,
  restoreFaults,
  until,
} from './support';

const DAY_MS = 24 * 60 * 60 * 1000;
const ready = () => useDatabaseStore.getState().ready;

/** A hydrate whose outcome the test may never look at: afterEach still drains it. */
const inflight: Promise<unknown>[] = [];
function run(): Promise<void> {
  const p = hydrateAllStores();
  inflight.push(p.catch(() => undefined));
  return p;
}

beforeEach(() => {
  resetHydrationMemory();
  usePublicationDisplayStore.setState({ language: null, names: {} });
});

afterEach(async () => {
  restoreFaults();
  await Promise.allSettled(inflight.splice(0));
  // Fire-and-forget tails (translation sweep, display-name save) finish here.
  await flush();
});

/**
 * The persona carries language_codes[0] === the seeded app language, so the
 * fire-and-forget language reconcile after hydration is a no-op and puts
 * nothing on the wire.
 */
function persona(overrides: Partial<UserPersona> = {}): UserPersona {
  return {
    _id: 'persona-1',
    userId: 'user-1',
    preferredNotificationWindow: [9, 18],
    notificationsEnabled: true,
    expoPushToken: null,
    onboardingStage: OnboardingStage.Finished,
    blockedByLlm: false,
    blockedByLlmReason: null,
    language_codes: ['de'],
    processingMode: ProcessingMode.OnDevice,
    llmWarningCount: 0,
    lastSuccessfulCompletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2026-01-02T00:00:00Z').toISOString(),
    ...overrides,
  };
}

async function seedEverySetting(): Promise<void> {
  // user-store
  await setSetting('cached_user_id', 'user-1');
  await setSetting('cached_user_email', 'reader@example.com');
  await setSetting('needs_reauth', '1');
  await persistUserPersona('user-1', persona());
  // the other stores
  await setSetting('mera_processing_mode', ProcessingMode.OnDevice);
  await setSetting('onboarding_state', JSON.stringify({ preferences: { countries: ['NL'], newsImpact: 'local' } }));
  await setSetting('app_language', 'de');
  await setSetting('last_authenticated_user_id', 'user-1');
  await setSetting(chapterCompletedKey('feed-basics'), 'true');
  await setSetting('tutorial_menu_seen', 'true');
  await setSetting('related_articles_sort', 'newest');
  await setSetting('for_you_recent_24h_only', '1');
  await setSetting('blur_images', '1');
  // the publisher source-name map
  await setSetting(
    PUBLISHER_SOURCE_NAMES_SETTING,
    JSON.stringify({ v: 1, publishers: [['pub-1', ['bbc news', 'bbc']]] }),
  );
}

describe('hydrateAllStores: seeded settings come back', () => {
  beforeEach(async () => {
    await seedEverySetting();
    await expect(run()).resolves.toBeUndefined();
  });

  it('user-store: id, re-auth flag and persona', () => {
    const s = useUserStore.getState();
    expect(s.userId).toBe('user-1');
    expect(s.needsReauth).toBe(true);
    expect(s.userPersona).toMatchObject({
      _id: 'persona-1',
      userId: 'user-1',
      processingMode: ProcessingMode.OnDevice,
      language_codes: ['de'],
    });
    // The DB copy has no TTL, so the next fetchUserPersona must go to the network.
    expect(s.lastFetchedAt).toBeNull();
  });

  it('mera-protocol, onboarding, app-language and app-state', () => {
    expect(useMeraProtocolStore.getState().processingMode).toBe(ProcessingMode.OnDevice);
    expect(useOnboardingStore.getState().preferences).toMatchObject({ countries: ['NL'], newsImpact: 'local' });
    expect(useAppLanguageStore.getState().appLanguage).toBe('de');
    expect(useAppStateStore.getState().lastAuthenticatedUserId).toBe('user-1');
  });

  it('tutorials, related sort, for-you prefs and blur images', () => {
    const tutorials = useTutorialsStore.getState();
    expect(tutorials.hydrated).toBe(true);
    expect(tutorials.menuSeen).toBe(true);
    expect(tutorials.completed.has('feed-basics')).toBe(true);
    expect(useRelatedSortStore.getState()).toMatchObject({ mode: 'newest', hydrated: true });
    expect(useForYouPrefsStore.getState()).toMatchObject({ recent24hOnly: true, hydrated: true });
    expect(useBlurImagesStore.getState()).toMatchObject({ blurImages: true, hydrated: true });
  });

  it('the publisher source-name map', () => {
    expect(knownSourceNamesForPublisher('pub-1')).toEqual(['bbc news', 'bbc']);
  });

  it('flips database-store.ready once everything has landed', () => {
    expect(ready()).toBe(true);
  });
});

describe('hydrateAllStores: the read hold', () => {
  it('restores a persisted hold before ready flips, so no scoring path reads it empty', async () => {
    const resetAt = Date.now() + 60 * 60 * 1000;
    await setReadHold({ resetAt, used: 1 });
    resetReadHold(); // a cold start: the row is on disk, memory is empty
    expect(getReadHold().resetAt).toBeNull();

    await run();
    expect(ready()).toBe(true);
    expect(getReadHold()).toEqual({ resetAt, used: 1 });
    expect(isReadHeld()).toBe(true);
  });
});

describe('hydrateAllStores: the db-ready ordering', () => {
  // One key per entry kind: a store, and the publisher source-name map.
  it.each([
    ['related_articles_sort', 'a store hydrate'],
    ['publisher_source_names_cache', 'the publisher source-name map'],
  ])('ready stays false while the read of %s (%s) is pending', async (key) => {
    const hold = holdSettingRead(key);
    expect(ready()).toBe(false);
    const done = run();
    await until(() => hold.hits() > 0, `the ${key} read to start`);
    await flush();
    expect(ready()).toBe(false);
    hold.release();
    await expect(done).resolves.toBeUndefined();
    expect(ready()).toBe(true);
  });

  it('hydrates in parallel: other stores land while one read is still pending', async () => {
    const hold = holdSettingRead('related_articles_sort');
    await setSetting('tutorial_menu_seen', 'true');
    const done = run();
    await until(() => useTutorialsStore.getState().hydrated, 'the tutorials hydrate');
    expect(useTutorialsStore.getState().menuSeen).toBe(true);
    expect(useRelatedSortStore.getState().hydrated).toBe(false);
    hold.release();
    await done;
  });
});

describe('hydrateAllStores: the paint-critical For-You hydrate', () => {
  it('is not awaited: hydrateAllStores settles and ready flips while the suggestion read is pending', async () => {
    const hold = holdTableQuery('article_suggestions');
    await expect(run()).resolves.toBeUndefined();
    expect(hold.hits()).toBeGreaterThan(0);
    expect(ready()).toBe(true);
    expect(useForYouStore.getState().suggestionsHydrated).toBe(false);
    hold.release();
    await until(() => useForYouStore.getState().suggestionsHydrated, 'the suggestion hydrate to finish');
  });

  it('a failure in it does not reject hydrateAllStores or block ready', async () => {
    failTableQuery('article_suggestions');
    await expect(run()).resolves.toBeUndefined();
    expect(ready()).toBe(true);
    // The hydrate still marks itself finished, so the Feed does not warm up forever.
    await until(() => useForYouStore.getState().suggestionsHydrated, 'the suggestion hydrate to finish');
  });
});

describe('hydrateAllStores: pruneStaleVisits after hydration', () => {
  async function seedVisits(): Promise<void> {
    freezeClockAt(Date.now() - 40 * DAY_MS);
    await recordPublicationVisit({ publicationName: 'Old Gazette', countryCode: 'NLD', articleId: 'stale-article' });
    jest.useRealTimers();
    await recordPublicationVisit({ publicationName: 'New Gazette', countryCode: 'NLD', articleId: 'fresh-article' });
  }
  const visitedArticleIds = async () =>
    (await database.get('publication_visits').query().fetch())
      .map((r) => (r as unknown as { articleId: string }).articleId)
      .sort();

  it('removes visits older than 30 days and keeps the rest', async () => {
    await seedVisits();
    expect(await visitedArticleIds()).toEqual(['fresh-article', 'stale-article']);
    await run();
    expect(await visitedArticleIds()).toEqual(['fresh-article']);
  });

  it('a failing prune does not block ready or reject hydrateAllStores', async () => {
    failTableQuery('publication_visits');
    await expect(run()).resolves.toBeUndefined();
    expect(ready()).toBe(true);
  });
});

describe('hydrateAllStores: a failing app-language read', () => {
  // The app-language read is the only entry whose failure escapes its own hydrate:
  // every other store swallows its read error. hydrateAllStores settles every entry,
  // so `ready` waits for the others, pruneStaleVisits still runs, and
  // app/_layout.tsx still reaches AppScheduler.onStoresHydrated().
  async function setup() {
    freezeClockAt(Date.now() - 40 * DAY_MS);
    await recordPublicationVisit({ publicationName: 'Old Gazette', countryCode: 'NLD', articleId: 'stale-article' });
    jest.useRealTimers();
    failSettingRead('app_language');
    return holdSettingRead('related_articles_sort');
  }
  const staleVisitCount = async () =>
    database.get('publication_visits').query().fetchCount();

  it('hydrateAllStores resolves, ready waits for every other entry, and the stale visit is pruned', async () => {
    const hold = await setup();
    const done = run();
    await flush();
    expect(ready()).toBe(false);
    hold.release();
    await expect(done).resolves.toBeUndefined();
    expect(ready()).toBe(true);
    expect(await staleVisitCount()).toBe(0);
  });
});

describe('hydrateAllStores: publication display names follow the app language', () => {
  const requests: { language: string; names: string[] }[] = [];
  beforeEach(() => {
    requests.length = 0;
    server.use(
      mockGql('PublicationDisplayNames', (v) => {
        requests.push({ language: String(v.language), names: v.names as string[] });
        return { publicationDisplayNames: [{ name: 'BBC News', displayName: 'BBC Nachrichten' }] };
      }),
    );
    // A name the screen asked for before the language was known.
    usePublicationDisplayStore.getState().request('BBC News');
  });
  const sentFor = (language: string) => requests.some((r) => r.language === language && r.names.includes('BBC News'));

  it('sends the PublicationDisplayNames request once the app language hydrates, and shows the answer', async () => {
    await setSetting('app_language', 'es');
    await run();
    await until(() => sentFor('es'), 'the PublicationDisplayNames request');
    await until(() => usePublicationDisplayStore.getState().names['BBC News'] !== undefined, 'the display name');
    expect(usePublicationDisplayStore.getState().names['BBC News']).toBe('BBC Nachrichten');
  });

  it('wires it while an unrelated hydrate is still pending, not after everything', async () => {
    await setSetting('app_language', 'es');
    const hold = holdSettingRead('related_articles_sort');
    const done = run();
    await until(() => sentFor('es'), 'the PublicationDisplayNames request');
    expect(ready()).toBe(false);
    hold.release();
    await done;
  });

  it('still wires it when an unrelated hydrate fails', async () => {
    await setSetting('app_language', 'es');
    failSettingRead('related_articles_sort');
    await expect(run()).resolves.toBeUndefined();
    await until(() => sentFor('es'), 'the PublicationDisplayNames request');
    expect(ready()).toBe(true);
  });

  it('still wires it, and a failing cache read still reaches ready, when the display cache cannot be read', async () => {
    await setSetting('app_language', 'es');
    failSettingRead('publication_display_names:es');
    await expect(run()).resolves.toBeUndefined();
    await until(() => sentFor('es'), 'the PublicationDisplayNames request');
    expect(ready()).toBe(true);
  });

  it('wires it even when the app-language read itself fails', async () => {
    failSettingRead('app_language');
    await run().catch(() => undefined);
    await until(() => sentFor('en'), 'the PublicationDisplayNames request');
  });
});
