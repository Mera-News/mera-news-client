// The queue's hold: a host keeps some job types waiting (a paused reader's background work) while
// the rest run, and lifts the hold later. A job of a held type that is already running finishes.
import { inferenceQueue, __setJobHandlerForTests } from '@/lib/inference/InferenceQueue';
import { cleanup, enqueueJob, hold, prepare, startIdle, turns, untilJob } from './kit';

beforeEach(prepare);
afterEach(async () => {
  inferenceQueue.hold([]);
  await cleanup();
});

const quick = () => jest.fn(async (..._args: unknown[]) => ({ ran: true }));

describe('hold', () => {
  it('keeps held types pending while other types run, and runs them once the hold is lifted', async () => {
    const summary = quick();
    const topics = quick();
    __setJobHandlerForTests('persona_summary', summary);
    __setJobHandlerForTests('topic_gen', topics);
    inferenceQueue.hold(['persona_summary']);
    const waiting = await enqueueJob('persona_summary', {});
    const edit = await enqueueJob('topic_gen', { factId: 'f1', factStatement: 'Plays chess' });

    await startIdle();
    await untilJob(edit, ['done']);
    await turns(20);
    expect(topics).toHaveBeenCalledTimes(1);
    expect(summary).not.toHaveBeenCalled();
    expect((await untilJob(waiting, ['pending']))?.status).toBe('pending');

    inferenceQueue.hold([]);
    await untilJob(waiting, ['done']);
    expect(summary).toHaveBeenCalledTimes(1);
  });

  it('names the type of the job running now, and a held type already running finishes', async () => {
    const parked = hold();
    __setJobHandlerForTests('topic_combo', parked.handler);
    const id = await enqueueJob('topic_combo', { factId: 'f1', passId: 'p1' });
    await startIdle();
    await parked.started;

    expect(inferenceQueue.runningType()).toBe('topic_combo');
    inferenceQueue.hold(['topic_combo']);
    parked.release();
    await untilJob(id, ['done', 'gone']);
    await turns(10);
    expect(inferenceQueue.runningType()).toBeNull();
  });
});
