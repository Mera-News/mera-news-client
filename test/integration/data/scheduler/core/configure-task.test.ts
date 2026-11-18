// AppScheduler.configureTask: a host changes a registered task's cadence and run timeout, and the
// tick and the runner use the new values. Only the clock and AppState are faked.
import '@/test/helpers';

import { AppScheduler } from '@/lib/scheduler/AppScheduler';
import * as persistence from '@/lib/scheduler/scheduler-persistence';
import { advanceUntilDone, useFakeClock } from '@/test/helpers';

import { addTask, resetScheduler, settle } from './support';

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);
const MINUTE = 60_000;

beforeEach(() => {
  useFakeClock(T0);
  resetScheduler();
});

afterEach(() => {
  AppScheduler.dispose();
});

describe('configureTask', () => {
  it('a shorter frequency makes the tick run a task the old one held back', async () => {
    const task = addTask({ frequency: 60 * MINUTE });
    await persistence.saveLastRun(task.name, T0 - 10 * MINUTE);
    await advanceUntilDone(AppScheduler.init());
    await settle(6_000);
    expect(task.runs).toHaveLength(0);

    AppScheduler.configureTask(task.name, { frequency: 5 * MINUTE });
    await settle(6_000);

    expect(task.runs).toHaveLength(1);
  });

  it('a shorter timeout aborts the run at the new limit', async () => {
    const task = addTask({ hang: true, timeout: 60_000, maxAttempts: 1 });
    AppScheduler.configureTask(task.name, { timeout: 1_000 });

    const running = AppScheduler.trigger(task.name, undefined, { bypassDebounce: true });
    await settle(1_100);

    expect(task.runs[0].ctx.signal.aborted).toBe(true);
    expect(task.runs[0].ctx.signal.reason).toBe('timeout');
    task.release();
    await advanceUntilDone(running);
  });

  it('keeps the values it was not given', async () => {
    const task = addTask({ frequency: 5 * MINUTE, hang: true, timeout: 1_000, maxAttempts: 1 });
    AppScheduler.configureTask(task.name, { frequency: 10 * MINUTE });

    const running = AppScheduler.trigger(task.name, undefined, { bypassDebounce: true });
    await settle(1_100);

    expect(task.runs[0].ctx.signal.aborted).toBe(true);
    task.release();
    await advanceUntilDone(running);
  });

  it('throws for a task that was never registered', () => {
    expect(() => AppScheduler.configureTask('no-such-task', { frequency: MINUTE })).toThrow('no-such-task');
  });
});

describe('definition', () => {
  it('returns what is registered, so a host that replaces a task can put the original back', () => {
    const task = addTask({ frequency: 60_000 });
    const original = AppScheduler.definition(task.name);
    expect(original).toBe(task.def);
    const replacement = { ...task.def, frequency: 1_000 };
    AppScheduler.register(replacement);
    expect(AppScheduler.definition(task.name)).toBe(replacement);
    AppScheduler.register(original!);
    expect(AppScheduler.definition(task.name)).toBe(task.def);
    expect(AppScheduler.definition('no-such-task')).toBeUndefined();
  });
});
