// hydrateAllStores runs the host's own restore inside the same settle-all as the package stores:
// `ready` waits for it, and a failure in it is reported without blocking `ready`.
import { hydrateAllStores } from '@/lib/database/hydrate-stores';
import { useDatabaseStore } from '@/lib/stores/database-store';
import { sentryCalls, testHost } from '@/test/helpers';
import { flush, resetHydrationMemory, restoreFaults } from './support';

const ready = () => useDatabaseStore.getState().ready;

beforeEach(() => resetHydrationMemory());
afterEach(async () => {
  restoreFaults();
  await flush();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the host restore hook', () => {
  it('holds database-store.ready false until the hook resolves', async () => {
    const hold = deferred();
    testHost.hydrateHostState = jest.fn(() => hold.promise);

    const done = hydrateAllStores();
    await flush();
    await flush();

    expect(testHost.hydrateHostState).toHaveBeenCalledTimes(1);
    expect(ready()).toBe(false);

    hold.resolve();
    await expect(done).resolves.toBeUndefined();
    expect(ready()).toBe(true);
  });

  it('a rejecting hook still flips ready, and the error is reported', async () => {
    const failure = new Error('host restore failed');
    testHost.hydrateHostState = jest.fn(() => Promise.reject(failure));

    await expect(hydrateAllStores()).resolves.toBeUndefined();

    expect(ready()).toBe(true);
    expect(sentryCalls.exceptions.map((e) => e.exception)).toContain(failure);
  });
});
