// With no host sink a registered writer is the plain function: same rows, same result, no request.
import { COMMANDS } from '@/lib/sync/commands';
import { recordOpen } from '@/lib/database/services/story-impression-service';
import { recordVerdictFeedback } from '@/lib/database/services/article-feedback-service';
import { resetDatabase, server, testHost } from '@/test/helpers';
import { CALLS, dumpRows, mask, seedCtx, useQueuedJobs } from './support';

type Fn = ((...a: unknown[]) => Promise<unknown>) & { local: (...a: unknown[]) => Promise<unknown> };
const commands = COMMANDS as unknown as Record<string, Fn>;

const requests: string[] = [];
beforeAll(() => void server.events.on('request:start', ({ request }) => void requests.push(request.url)));
beforeEach(() => {
  requests.length = 0;
  useQueuedJobs();
});

async function run(call: (...a: unknown[]) => Promise<unknown>, name: string) {
  await resetDatabase();
  const ctx = await seedCtx();
  requests.length = 0;
  const outcome = await call(...CALLS[name](ctx)).then(
    (value) => ({ value }),
    (error: Error) => ({ error: error.message }),
  );
  return { text: mask({ outcome, tables: await dumpRows() }, [...Object.values(ctx).filter((v): v is string => typeof v === 'string'), ctx.suggestion._id]), requests: [...requests] };
}

it('records one call for every registered writer', () => {
  expect(Object.keys(CALLS).sort()).toEqual(Object.keys(COMMANDS).sort());
});

describe('no podCommand on the host', () => {
  it('has none', () => expect(testHost.podCommand).toBeUndefined());

  it.each(Object.keys(CALLS))('%s gives the rows, result and requests of the unwrapped function', async (name) => {
    const wrapped = await run(commands[name], name);
    const plain = await run(commands[name].local, name);
    expect(JSON.parse(wrapped.text)).toEqual(JSON.parse(plain.text));
    expect(wrapped.requests).toEqual(plain.requests);
  });
});

// The three writers no other test drives, on real rows rather than a seeded stand-in.
describe('real data', () => {
  const seedAndRun = async (call: (c: import('./support').Ctx) => Promise<unknown>) => {
    await resetDatabase();
    const ctx = await seedCtx();
    const outcome = await call(ctx).then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    );
    return mask({ outcome, tables: await dumpRows() }, [...Object.values(ctx).filter((v): v is string => typeof v === 'string'), ctx.suggestion._id]);
  };

  it('clearAllImpressions empties the opened rows exactly as the unwrapped function does', async () => {
    const run = async (fn: (...a: unknown[]) => Promise<unknown>) =>
      seedAndRun(async () => {
        await recordOpen({ articleId: 'a1', surface: 'feed' });
        await recordOpen({ articleId: 'a2', surface: 'feed' });
        return fn();
      });
    const wrapped = await run(commands.clearAllImpressions);
    expect(wrapped).toEqual(await run(commands.clearAllImpressions.local));
    expect(JSON.parse(wrapped).tables.story_impressions).toEqual([]);
  });

  it('recordFeedbackAnswer rewrites a stored dislike exactly as the unwrapped function does', async () => {
    const run = async (fn: (...a: unknown[]) => Promise<unknown>) =>
      seedAndRun(async (c) => {
        await recordVerdictFeedback({ articleId: c.suggestion.articleId, sentiment: 'dislike', title: 'T' });
        return fn(c.suggestion.articleId, { leafId: 'wrong_place', path: ['a'], cause: 'config' }, { applied: false });
      });
    const wrapped = await run(commands.recordFeedbackAnswer);
    expect(wrapped).toEqual(await run(commands.recordFeedbackAnswer.local));
    expect(JSON.parse(wrapped).tables.article_feedback).toHaveLength(1);
  });

  it('removeFailedChatFact removes a fact whose statement matches exactly as the unwrapped function does', async () => {
    const run = async (fn: (...a: unknown[]) => Promise<unknown>) =>
      seedAndRun(async (c) => fn(c.factId, 'Follows chess', { inOwnJob: true }));
    const wrapped = await run(commands.removeFailedChatFact);
    expect(wrapped).toEqual(await run(commands.removeFailedChatFact.local));
  });
});
