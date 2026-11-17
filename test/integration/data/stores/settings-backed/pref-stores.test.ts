// for-you-prefs and related-sort stores against the real settings table: set, read the row back, drop
// the memory, hydrate, same value.
import logger from '@/lib/logger';
import { getSetting, setSetting } from '@/lib/database/services/setting-service';
import { useForYouPrefsStore } from '@/lib/stores/for-you-prefs-store';
import {
  DEFAULT_RELATED_SORT_MODE,
  RELATED_SORT_MODES,
  parseRelatedSortMode,
  useRelatedSortStore,
} from '@/lib/stores/related-sort-store';
import { failNextWrite, failSettingRead, flush, persisted, resetStore, restoreFaults } from './support';

jest.mock('@/lib/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    addBreadcrumb: jest.fn(),
  },
}));

beforeEach(() => {
  resetStore(useForYouPrefsStore);
  resetStore(useRelatedSortStore);
});
afterEach(() => {
  restoreFaults();
  jest.restoreAllMocks();
});

const reported = (store: string) =>
  expect(logger.captureException).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { store } }));

describe('for-you-prefs-store', () => {
  const KEY = 'for_you_recent_24h_only';
  const store = useForYouPrefsStore;

  it('starts off and unhydrated; hydrate with no row stays off', async () => {
    expect(store.getState()).toMatchObject({ recent24hOnly: false, hydrated: false });
    await store.getState().hydrate();
    expect(store.getState()).toMatchObject({ recent24hOnly: false, hydrated: true });
  });

  it.each([
    [true, '1'],
    [false, '0'],
  ])('setting %s persists %s and survives a rehydrate', async (value, row) => {
    // Start from the opposite value so the round trip cannot pass on the default.
    if (!value) await setSetting(KEY, '1');
    store.getState().setRecent24hOnly(value);
    expect(store.getState().recent24hOnly).toBe(value);
    // For `false` the seeded '1' is already there: wait for the new value.
    expect(await persisted(KEY, row)).toBe(row);

    resetStore(store);
    await store.getState().hydrate();
    expect(store.getState()).toMatchObject({ recent24hOnly: value, hydrated: true });
  });

  it('reads any value other than "1" as off', async () => {
    await setSetting(KEY, 'true');
    await store.getState().hydrate();
    expect(store.getState().recent24hOnly).toBe(false);
  });

  it('a failed read leaves the default, still hydrates and reports', async () => {
    const err = new Error('db crash');
    failSettingRead(KEY, err);
    await expect(store.getState().hydrate()).resolves.toBeUndefined();
    expect(store.getState()).toMatchObject({ recent24hOnly: false, hydrated: true });
    expect(logger.captureException).toHaveBeenCalledWith(err, expect.objectContaining({ tags: { store: 'for-you-prefs-store' } }));
  });

  it('a failed write is reported and keeps the in-memory choice', async () => {
    failNextWrite(new Error('persist fail'));
    store.getState().setRecent24hOnly(true);
    await flush();
    expect(store.getState().recent24hOnly).toBe(true);
    reported('for-you-prefs-store');
    expect(await getSetting(KEY)).toBeNull();
  });
});

describe('related-sort-store', () => {
  const KEY = 'related_articles_sort';
  const store = useRelatedSortStore;

  describe('parseRelatedSortMode', () => {
    it.each(RELATED_SORT_MODES)('accepts the known mode %s', (mode) => {
      expect(parseRelatedSortMode(mode)).toBe(mode);
    });

    it.each([null, undefined, '', 'RELEVANCE', 'random'])('falls back to the default for %p', (raw) => {
      expect(parseRelatedSortMode(raw)).toBe(DEFAULT_RELATED_SORT_MODE);
    });

    it('honours an explicit fallback', () => {
      expect(parseRelatedSortMode('nope', 'newest')).toBe('newest');
    });
  });

  it("defaults to today's ordering, unhydrated; no row hydrates to the default", async () => {
    expect(store.getState()).toMatchObject({ mode: 'relevance', hydrated: false });
    await store.getState().hydrate();
    expect(store.getState()).toMatchObject({ mode: 'relevance', hydrated: true });
  });

  it.each(['oldest', 'newest'] as const)('setMode(%s) applies at once, persists, and survives a rehydrate', async (mode) => {
    store.getState().setMode(mode);
    expect(store.getState().mode).toBe(mode);
    expect(await persisted(KEY)).toBe(mode);

    resetStore(store);
    await store.getState().hydrate();
    expect(store.getState()).toMatchObject({ mode, hydrated: true });
  });

  it('ignores an unrecognised stored value', async () => {
    await setSetting(KEY, 'by-vibes');
    await store.getState().hydrate();
    expect(store.getState()).toMatchObject({ mode: 'relevance', hydrated: true });
  });

  it('a failed read leaves the default, still hydrates and reports', async () => {
    failSettingRead(KEY);
    await store.getState().hydrate();
    reported('related-sort-store');
    expect(store.getState()).toMatchObject({ mode: 'relevance', hydrated: true });
  });

  it('a failed write is reported without losing the in-memory choice', async () => {
    failNextWrite(new Error('disk full'));
    store.getState().setMode('oldest');
    await flush();
    expect(store.getState().mode).toBe('oldest');
    reported('related-sort-store');
  });

  it('reset returns to the default and unhydrated (the clearAllStores path)', async () => {
    await setSetting(KEY, 'newest');
    await store.getState().hydrate();
    expect(store.getState().mode).toBe('newest');
    store.getState().reset();
    expect(store.getState()).toMatchObject({ mode: 'relevance', hydrated: false });
  });
});
