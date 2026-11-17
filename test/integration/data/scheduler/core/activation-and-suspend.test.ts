// Process-lifetime scheduler state that dispose() cannot reset: the once-per-process keychain
// migration and the permanent `suspended` flag. This file owns both, so it is its own module
// registry; the suspend tests come last because nothing can lift a suspension.
import '@/test/helpers';

import { AppScheduler } from '@/lib/scheduler/AppScheduler';
import { useSchedulerStore } from '@/lib/scheduler/scheduler-store';
import { advanceUntilDone, setAppState, testHost, useFakeClock } from '@/test/helpers';

import { addTask, jobRows, resetScheduler, settle } from './support';

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);

// The host records the foreground time and runs the keychain migration; the scheduler decides when.
const recordForeground = jest.fn(async (_at: number) => undefined);
const runKeychainAccessibilityMigration = jest.fn(async () => 'migrated' as const);

beforeEach(() => {
  useFakeClock(T0);
  resetScheduler();
  recordForeground.mockClear();
  testHost.recordForeground = recordForeground;
  testHost.runKeychainAccessibilityMigration = runKeychainAccessibilityMigration;
});

afterEach(() => {
  AppScheduler.dispose();
});

const init = () => advanceUntilDone(AppScheduler.init());

describe('a real activation', () => {
  it('records last_foreground_at, and starts the keychain migration only once per process', async () => {
    await init();
    expect(recordForeground).not.toHaveBeenCalled();

    setAppState('background');
    setAppState('active');
    await settle(500);

    expect(recordForeground).toHaveBeenCalledTimes(1);
    expect(recordForeground.mock.calls[0][0]).toBeGreaterThanOrEqual(T0);
    expect(runKeychainAccessibilityMigration).toHaveBeenCalledTimes(1);

    // Second activation: the foreground stamp moves, the migration does not run again.
    jest.setSystemTime(T0 + 60_000);
    setAppState('background');
    setAppState('active');
    await settle(500);

    expect(recordForeground).toHaveBeenCalledTimes(2);
    expect(recordForeground.mock.calls[1][0]).toBeGreaterThanOrEqual(T0 + 60_000);
    expect(runKeychainAccessibilityMigration).toHaveBeenCalledTimes(1);
  });

  it('is not recorded for a backgrounding, only for an activation', async () => {
    await init();

    setAppState('background');
    await settle(500);

    expect(recordForeground).not.toHaveBeenCalled();
  });
});

describe('suspend (the mandatory-update gate)', () => {
  it('during init leaves no tick, no listener and no run armed', async () => {
    const task = addTask({ frequency: 10_000, triggers: ['app-foreground', 'network-reconnect'] });

    const initializing = AppScheduler.init();
    AppScheduler.suspend();
    await advanceUntilDone(initializing);

    setAppState('background');
    setAppState('active');
    await settle(30_000);

    expect(task.runs).toHaveLength(0);
    expect(useSchedulerStore.getState().status).toBe('paused');
  });

  it('turns a later init into a no-op and a later trigger into a run that never starts', async () => {
    const task = addTask({ frequency: 10_000 });

    await init();
    await settle(30_000);
    expect(task.runs).toHaveLength(0);
    expect(useSchedulerStore.getState().status).not.toBe('running');

    await expect(advanceUntilDone(AppScheduler.trigger(task.name))).resolves.toBe('ran');
    expect(task.runs).toHaveLength(0);
    expect(await jobRows(task.name)).toHaveLength(0);
  });
});
