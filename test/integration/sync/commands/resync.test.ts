// resync asks the pod for a read, and answers paused without starting one while reads are paused.
import { COMMANDS } from '@/lib/sync/commands';
import { AppScheduler } from '@/lib/scheduler/AppScheduler';
import { server } from '@/test/helpers';
import { registerFeedSyncCounter } from '../../data/scheduler/tasks/support';
import { resetScheduler } from '../../data/scheduler/core/support';

beforeEach(resetScheduler);
afterEach(() => AppScheduler.dispose());

it('starts the feed sync', async () => {
  const counter = registerFeedSyncCounter();
  await COMMANDS.resync();
  expect(counter.runs).toBe(1);
});

it('answers paused and starts nothing while the feed sync is paused', async () => {
  const requests: string[] = [];
  server.events.on('request:start', ({ request }) => void requests.push(request.url));
  const counter = registerFeedSyncCounter();
  AppScheduler.pauseTask('feed-sync');

  await expect(COMMANDS.resync()).resolves.toBe('paused');

  expect(counter.runs).toBe(0);
  expect(requests).toEqual([]);
  server.events.removeAllListeners();
});
