// clearAllStores runs the host's own reset last: the database is already empty and every package
// store already back at its start, so nothing the host reads can still hold the old account.
import database from '@/lib/database';
import { setSetting } from '@/lib/database/services/setting-service';
import { clearAllStores } from '@/lib/stores';
import { useForYouStore } from '@/lib/stores/for-you-store';
import { useTutorialsStore } from '@/lib/stores/tutorials-store';
import { testHost } from '@/test/helpers';
import { flush, resetHydrationMemory } from './support';

beforeEach(() => resetHydrationMemory());
afterEach(async () => {
  jest.restoreAllMocks();
  // clearAllStores fires some deletes without awaiting them.
  await flush();
});

describe('the host reset hook', () => {
  it('runs after the database is empty and the package stores are reset', async () => {
    await setSetting('cached_user_id', 'old-user');
    await setSetting('tutorial_menu_seen', 'true');
    useForYouStore.setState({ articleCount: 12, relevantArticleCount: 4, lastSyncAt: 1 });
    useTutorialsStore.setState({ completed: new Set(['chapter-1']), menuSeen: true, hydrated: true });

    const seen: { settings: number; forYou: unknown; tutorials: unknown }[] = [];
    testHost.resetHostState = jest.fn(async () => {
      const { articleCount, relevantArticleCount, lastSyncAt } = useForYouStore.getState();
      const { menuSeen, hydrated, completed } = useTutorialsStore.getState();
      seen.push({
        settings: await database.get('settings').query().fetchCount(),
        forYou: { articleCount, relevantArticleCount, lastSyncAt },
        tutorials: { menuSeen, hydrated, completed: completed.size },
      });
    });

    await clearAllStores();

    expect(testHost.resetHostState).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      {
        settings: 0,
        forYou: { articleCount: 0, relevantArticleCount: 0, lastSyncAt: null },
        tutorials: { menuSeen: false, hydrated: false, completed: 0 },
      },
    ]);
  });

  it('is never called when the database reset fails', async () => {
    testHost.resetHostState = jest.fn(async () => {});
    jest.spyOn(database, 'unsafeResetDatabase').mockRejectedValueOnce(new Error('db locked'));

    await expect(clearAllStores()).rejects.toThrow('db locked');

    expect(testHost.resetHostState).not.toHaveBeenCalled();
  });
});
