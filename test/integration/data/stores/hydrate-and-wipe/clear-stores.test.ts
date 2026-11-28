// clearAllStores against the real stores and the in-memory WatermelonDB.
import database from '@/lib/database';
import {
  clearAllStores,
  useConfigPanelStore,
  useFloatingChatStore,
  useForYouStore,
  useMeraProtocolStore,
  useUIStore,
  useUserStore,
} from '@/lib/stores';
import { addFact } from '@/lib/database/services/fact-service';
import { persistUserPersona } from '@/lib/database/services/user-persona-service';
import { recordPublicationVisit } from '@/lib/database/services/publication-visit-service';
import { trackStory } from '@/lib/database/services/tracked-story-service';
import { getSetting, setSetting } from '@/lib/database/services/setting-service';
import {
  knownSourceNamesForPublisher,
  rememberPublisherSourceNames,
} from '@/lib/database/services/publisher-source-names';
import { getReadHold, hydrateReadHold, isReadHeld, setReadHold } from '@/lib/subscription/read-hold';
import { useFeedOrderStore } from '@/lib/stores/feed-order-store';
import { useRelatedSortStore } from '@/lib/stores/related-sort-store';
import { useTutorialsStore } from '@/lib/stores/tutorials-store';
import { OnboardingStage, ProcessingMode } from '@/lib/generated/graphql-types';
import { flush, resetHydrationMemory } from './support';
import { holdForOwnNote, isNoteHeld } from '@/lib/feed-ordering/note-hold';

beforeEach(() => {
  resetHydrationMemory();
  // resetHydrationMemory covers the hydrated stores; these are cleared by clearAllStores too.
  useUIStore.setState(useUIStore.getInitialState(), true);
  useConfigPanelStore.setState(useConfigPanelStore.getInitialState(), true);
  useFloatingChatStore.getState().reset();
});

afterEach(async () => {
  jest.restoreAllMocks();
  // clearAllStores fires clearData() and the user-store deletes without awaiting.
  await flush();
});

const tableCount = (table: string) => database.get(table).query().fetchCount();

/** One row in each of the six tables hasLocalUserData() treats as "a user lives here", plus settings. */
async function seedUserData(): Promise<void> {
  await addFact('I follow Formula 1 racing');
  await persistUserPersona('old-user', {
    _id: 'persona-1',
    userId: 'old-user',
    preferredNotificationWindow: [9, 18],
    notificationsEnabled: true,
    expoPushToken: null,
    onboardingStage: OnboardingStage.Finished,
    blockedByLlm: false,
    blockedByLlmReason: null,
    language_codes: ['en'],
    processingMode: ProcessingMode.Cloud,
    llmWarningCount: 0,
    lastSuccessfulCompletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  });
  await recordPublicationVisit({ publicationName: 'Gazette', countryCode: 'NLD', articleId: 'a-1' });
  await trackStory({ articleId: 'a-1', title: 'A followed story', originSurface: 'feed' });
  // No service writes a bare suggestion row without a whole sync; one row is enough here.
  await database.write(() =>
    database.get('article_suggestions').create((r) => {
      (r as unknown as { serverId: string }).serverId = 'suggestion-1';
    }),
  );
  await setSetting('cached_user_id', 'old-user');
}

const USER_TABLES = [
  'facts',
  'user_personas',
  'publication_visits',
  'tracked_stories',
  'article_suggestions',
] as const;

describe('clearAllStores: database', () => {
  it('empties every user table', async () => {
    await seedUserData();
    for (const table of USER_TABLES) expect(await tableCount(table)).toBeGreaterThan(0);

    await expect(clearAllStores()).resolves.toBeUndefined();

    for (const table of USER_TABLES) expect(await tableCount(table)).toBe(0);
    expect(await getSetting('cached_user_id')).toBeNull();
  });
});

describe('clearAllStores: Zustand stores', () => {
  it('resets for-you, user, ui, config-panel, floating-chat', async () => {
    useForYouStore.setState({ articleCount: 12, relevantArticleCount: 4, lastSyncAt: 1 });
    useUserStore.setState({ userId: 'old-user', needsReauth: true, lastFetchedAt: 5 });
    useUIStore.getState().openModal('logout');
    useConfigPanelStore.getState().openPanel();
    useFloatingChatStore.getState().expand();

    await clearAllStores();

    expect(useForYouStore.getState()).toMatchObject({ articleCount: 0, relevantArticleCount: 0, lastSyncAt: null });
    expect(useUserStore.getState()).toMatchObject({
      userId: null,
      userPersona: null,
      needsReauth: false,
      lastFetchedAt: null,
    });
    expect(useUIStore.getState().modals.logout.isOpen).toBe(false);
    expect(useConfigPanelStore.getState().isOpen).toBe(false);
    expect(useFloatingChatStore.getState().isExpanded).toBe(false);
  });

  it('resets mera-protocol, feed-order, related-sort and tutorials', async () => {
    useMeraProtocolStore.setState({ processingMode: ProcessingMode.OnDevice });
    useFeedOrderStore.setState({ order: ['a', 'b'], builtAt: 1 });
    useRelatedSortStore.setState({ mode: 'newest', hydrated: true });
    useTutorialsStore.setState({ completed: new Set(['chapter-1']), menuSeen: true, hydrated: true });

    await clearAllStores();

    expect(useMeraProtocolStore.getState().processingMode).toBe(ProcessingMode.Cloud);
    expect(useFeedOrderStore.getState().order).toEqual([]);
    expect(useRelatedSortStore.getState()).toMatchObject({ mode: 'relevance', hydrated: false });
    expect(useTutorialsStore.getState()).toMatchObject({ menuSeen: false, hydrated: false });
    expect(useTutorialsStore.getState().completed.size).toBe(0);
  });
});

describe('clearAllStores: module mirrors', () => {
  it('forgets the rows held for their own note', async () => {
    holdForOwnNote(['row-1']);
    await clearAllStores();
    expect(isNoteHeld('row-1')).toBe(false);
  });

  it('forgets the publisher source-name map, so the next account never inherits it', async () => {
    rememberPublisherSourceNames('pub-1', ['BBC News', 'BBC']);
    expect(knownSourceNamesForPublisher('pub-1')).not.toBeNull();
    await clearAllStores();
    expect(knownSourceNamesForPublisher('pub-1')).toBeNull();
  });

  it('forgets the read hold, so the next account never starts held', async () => {
    await setReadHold({ resetAt: Date.now() + 60 * 60 * 1000, used: 1 });
    expect(isReadHeld()).toBe(true);

    await clearAllStores();
    expect(isReadHeld()).toBe(false);
    expect(getReadHold()).toEqual({ resetAt: null, used: null });
    // The row went with the database, so the next hydrate finds nothing either.
    await hydrateReadHold();
    expect(isReadHeld()).toBe(false);
  });
});
