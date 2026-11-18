// A task paused while the tick is still in its authenticated pre-flight must not run: the pause can
// land in that await, after the tick's own pause check. Only the clock and AppState are faked.
import '@/test/helpers';

import { AppScheduler } from '@/lib/scheduler/AppScheduler';
import { useUserStore } from '@/lib/stores/user-store';
import { advanceUntilDone, testHost, useFakeClock } from '@/test/helpers';

import { addTask, resetScheduler, settle } from './support';

const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);

beforeEach(() => {
  useFakeClock(T0);
  resetScheduler();
  useUserStore.setState({ userPersona: {} as never });
});

afterEach(() => {
  AppScheduler.dispose();
  jest.restoreAllMocks();
});

it('a task paused during its credential lookup does not run, and runs once resumed', async () => {
  // A lookup that answers in one second, inside the pre-flight budget.
  jest.spyOn(testHost.auth, 'getJwtToken').mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('jwt'), 1_000)));
  const task = addTask({ frequency: 10_000, conditions: [{ type: 'authenticated' }] });
  const starting = AppScheduler.init();
  await settle(500);

  AppScheduler.pauseTask(task.name);
  await settle(1_000);
  expect(task.runs).toHaveLength(0);

  AppScheduler.resumeTask(task.name);
  await settle(12_000);
  expect(task.runs.length).toBeGreaterThan(0);
  await advanceUntilDone(starting);
});
