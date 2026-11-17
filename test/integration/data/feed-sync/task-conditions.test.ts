// The feed-sync task's condition list, read from the definition it hands to AppScheduler.register
// (a call-through spy on a fresh scheduler module, so nothing private is read). The behaviour tests
// in machine/task.test.ts cannot see this: a custom condition that always passes is invisible to
// them, so only the COUNT pins "no custom condition at all": no tier gate and no reading gate (a
// condition is not enforcement; the read hold lives at the scoring dispatch).
import type { TaskDefinition } from '@/lib/scheduler/scheduler-types';
import { useFakeClock } from '@/test/helpers';

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

/** Loads the task module against a fresh scheduler and returns the definition it registered. */
function registeredDefinition(): TaskDefinition<unknown> {
  let definition: TaskDefinition<unknown> | undefined;
  jest.isolateModules(() => {
    // The isolated registry holds its own platform module, so it needs its own registered host.
    (require('@/test/helpers/platform-host') as typeof import('@/test/helpers/platform-host')).installTestPlatform();
    const { AppScheduler } = require('@/lib/scheduler/AppScheduler') as typeof import('@/lib/scheduler/AppScheduler');
    const register = jest.spyOn(AppScheduler, 'register'); // call-through: the real registration still runs
    require('@/lib/scheduler/tasks/feed-sync-task');
    expect(register).toHaveBeenCalledTimes(1);
    definition = register.mock.calls[0][0] as TaskDefinition<unknown>;
  });
  return definition as TaskDefinition<unknown>;
}

describe('feed-sync task conditions', () => {
  beforeEach(() => {
    useFakeClock(NOW);
  });

  it('has exactly network, authenticated and db-ready, and no custom condition', () => {
    const { conditions = [] } = registeredDefinition();

    expect(conditions.map((c) => c.type).sort()).toEqual(['authenticated', 'db-ready', 'network']);
    expect(conditions).toHaveLength(3);
  });
});
