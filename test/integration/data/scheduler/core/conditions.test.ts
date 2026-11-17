// The four TaskCondition kinds as the tick evaluates them: db-ready, network, custom and the
// authenticated pre-flight (the host's getJwtToken, driven through authState).
import '@/test/helpers';

import { AppScheduler } from '@/lib/scheduler/AppScheduler';
import type { TaskCondition } from '@/lib/scheduler/scheduler-types';
import { useDatabaseStore } from '@/lib/stores/database-store';
import { useNetworkStore } from '@/lib/stores/network-store';
import { useUserStore } from '@/lib/stores/user-store';
import { advanceUntilDone, authState, testHost, useFakeClock as freezeClock } from '@/test/helpers';

import { addTask, resetScheduler, settle } from './support';

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);

beforeEach(() => {
  freezeClock(T0);
  resetScheduler();
});

afterEach(() => {
  AppScheduler.dispose();
});

/** A timer task behind one condition; init fires its first tick at once. */
async function startWith(condition: TaskCondition) {
  const task = addTask({ frequency: 10_000, conditions: [condition] });
  await advanceUntilDone(AppScheduler.init());
  return task;
}

describe('db-ready', () => {
  it('skips the task until the database store reports ready, then runs it on the next tick', async () => {
    const task = await startWith({ type: 'db-ready' });
    await settle(11_000);
    expect(task.runs).toHaveLength(0);

    useDatabaseStore.setState({ ready: true });
    await settle(5_100);

    expect(task.runs).toHaveLength(1);
  });
});

describe('network', () => {
  it('skips the task while the device is offline and runs it once the link is back', async () => {
    useNetworkStore.getState().setIsConnected(false);
    const task = await startWith({ type: 'network' });
    await settle(11_000);
    expect(task.runs).toHaveLength(0);

    useNetworkStore.getState().setIsConnected(true);
    await settle(5_100);

    expect(task.runs).toHaveLength(1);
  });
});

describe('custom', () => {
  it('respects a synchronous check: false skips, true runs', async () => {
    let allowed = false;
    const task = await startWith({ type: 'custom', check: () => allowed });
    await settle(11_000);
    expect(task.runs).toHaveLength(0);

    allowed = true;
    await settle(5_100);

    expect(task.runs).toHaveLength(1);
  });

  // The skill documents this as a silent kill ("a Promise is always truthy"). It is not, today:
  // `_checkCondition` is an `async` function, so returning the Promise from `check` adopts it and
  // `await _checkCondition(...)` sees the real boolean. The TYPE still forbids it, and the gate
  // only holds while that async wrapper does. Pinned as today's behaviour.
  it('awaits a check that returns a Promise, because _checkCondition is async: an async false still gates the task', async () => {
    let allowed = false;
    const asyncCheck = (async () => allowed) as unknown as () => boolean;

    const task = await startWith({ type: 'custom', check: asyncCheck });
    await settle(11_000);
    expect(task.runs).toHaveLength(0);

    allowed = true;
    await settle(5_100);

    expect(task.runs).toHaveLength(1);
  });

  it('lets a task through whose condition type is unknown to the scheduler', async () => {
    const task = await startWith({ type: 'from-the-future' } as unknown as TaskCondition);
    await settle(500);

    expect(task.runs).toHaveLength(1);
  });

  it('checks every condition, so one failing condition blocks the task', async () => {
    const task = addTask({
      frequency: 10_000,
      conditions: [{ type: 'custom', check: () => true }, { type: 'custom', check: () => false }],
    });
    await advanceUntilDone(AppScheduler.init());
    await settle(11_000);

    expect(task.runs).toHaveLength(0);
  });
});

describe('authenticated', () => {
  let jwtCalls: jest.SpyInstance;

  beforeEach(() => {
    jwtCalls = jest.spyOn(testHost.auth, 'getJwtToken');
    useUserStore.setState({ userPersona: {} as never });
  });

  it('passes for a signed-in account: the credential lookup succeeds', async () => {
    const task = await startWith({ type: 'authenticated' });
    await settle(1_000);

    expect(task.runs).toHaveLength(1);
    expect(jwtCalls).toHaveBeenCalled();
  });

  it('fails for a signed-out account, after looking up the credential', async () => {
    Object.assign(authState, { jwt: null, cookie: null });

    const task = await startWith({ type: 'authenticated' });
    await settle(11_000);

    expect(jwtCalls).toHaveBeenCalled();
    expect(task.runs).toHaveLength(0);
  });

  it('passes optimistically when the credential lookup outlasts the 1.5s pre-flight budget', async () => {
    jwtCalls.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('late'), 20_000)));

    const task = await startWith({ type: 'authenticated' });
    await settle(1_000);
    expect(task.runs).toHaveLength(0);

    await settle(1_500);

    // Ran long before the 20s answer could arrive: the timeout passed it.
    expect(task.runs).toHaveLength(1);
  });

  it('fails at once with no persona, without looking up the credential', async () => {
    useUserStore.setState({ userPersona: null });

    const task = await startWith({ type: 'authenticated' });
    await settle(11_000);

    expect(task.runs).toHaveLength(0);
    expect(jwtCalls).not.toHaveBeenCalled();
  });

  it('fails at once when the breaker flagged the session dead, even while offline', async () => {
    useUserStore.setState({ needsReauth: true });
    useNetworkStore.getState().setIsConnected(false);

    const task = await startWith({ type: 'authenticated' });
    await settle(11_000);

    expect(task.runs).toHaveLength(0);
    expect(jwtCalls).not.toHaveBeenCalled();
  });

  it('passes while offline without checking the credential (local identity is enough)', async () => {
    useNetworkStore.getState().setIsConnected(false);

    const task = await startWith({ type: 'authenticated' });
    await settle(500);

    expect(task.runs).toHaveLength(1);
    expect(jwtCalls).not.toHaveBeenCalled();
  });
});
