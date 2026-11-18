// With a host sink a registered writer sends its name and arguments and does not run on the phone.
import { COMMAND_REGISTRY_VERSION, CommandArgumentsError, registeredCommandNames } from '@/lib/sync/command';
import { COMMANDS } from '@/lib/sync/commands';
import { deleteFact } from '@/lib/database/services/fact-service';
import { deleteTopicWithDecline } from '@/lib/database/services/topic-decline-service';
import { addSuppression } from '@/lib/database/services/suppression-service';
import { applyPersonaAction } from '@/lib/database/services/persona-action-executor';
import { trackStoryWithProposal } from '@/lib/tracking/track-actions';
import { ACTION_NAMES } from '@/lib/news-harness/persona-management/action-names';
import database from '@/lib/database';
import { testHost } from '@/test/helpers';
import { CALLS, dumpRows, seedCtx, useQueuedJobs, type Ctx } from './support';

type Sent = { name: string; args: unknown[]; registry: number };
const sent: Sent[] = [];
let ctx: Ctx;

beforeEach(async () => {
  useQueuedJobs();
  ctx = await seedCtx();
  sent.length = 0;
  testHost.podCommand = async (c) => {
    sent.push(c);
    // A writer that returns a model gets the id of a row that exists here.
    const answers: Record<string, unknown> = {
      addSuppression: { id: ctx.suppressionId },
      upsertSubscription: { id: ctx.subscriptionId },
      createTopics: { ids: [ctx.topicId] },
      addUserLocation: { location: { id: ctx.locationId }, updated: false },
    };
    return answers[c.name] ?? {};
  };
});

const commands = COMMANDS as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;

describe('one command per call', () => {
  it.each(Object.keys(CALLS))('%s sends its own name once and changes no row', async (name) => {
    const before = JSON.stringify(await dumpRows());
    const args = CALLS[name](ctx);

    await commands[name](...args);

    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe(name);
    expect(sent[0].registry).toBe(COMMAND_REGISTRY_VERSION);
    expect(JSON.stringify(await dumpRows())).toEqual(before);
  });

  it('sends an outer writer that calls an inner registered one as the outer alone', async () => {
    await applyPersonaAction({ action_type: ACTION_NAMES.DISCARD_FACT, factId: ctx.factId }, 'user');
    expect(sent.map((s) => s.name)).toEqual(['applyPersonaAction']);

    sent.length = 0;
    await trackStoryWithProposal(CALLS.trackStoryWithProposal(ctx)[0] as never, { label: 'L', searchText: 'q' });
    expect(sent.map((s) => s.name)).toEqual(['trackStoryWithProposal']);
  });
});

describe('arguments', () => {
  it.each(Object.keys(CALLS))('%s sends arguments equal to their JSON round trip', async (name) => {
    await commands[name](...CALLS[name](ctx));
    expect(sent[0].args).toEqual(JSON.parse(JSON.stringify(sent[0].args)));
  });

  it('refuses a model instance, naming the command, and sends nothing', async () => {
    const model = await database.get('facts').find(ctx.factId);
    await expect(commands.deleteFact(model)).rejects.toThrow(CommandArgumentsError);
    await expect(commands.deleteFact(model)).rejects.toThrow(/deleteFact/);
    expect(sent).toHaveLength(0);
  });

  it('drops what only means something on the phone', async () => {
    await commands.removeFailedChatFact('f', 'statement', { inOwnJob: true });
    expect(sent[0].args).toEqual(['f', 'statement']);
  });
});

describe('order and failure', () => {
  it('rejects the failed one with the pod error and the one behind it unsent, then recovers', async () => {
    const error = { code: 'nope', message: 'refused' };
    testHost.podCommand = async (c) => {
      sent.push(c);
      if (c.args[0] === 'second') throw error;
      return {};
    };

    const first = deleteFact('first');
    const second = deleteFact('second');
    const third = deleteFact('third');

    await expect(first).resolves.toEqual({});
    await expect(second).rejects.toBe(error);
    await expect(third).rejects.toMatchObject({ code: 'earlier_change_failed' });
    expect(sent.map((s) => s.args[0])).toEqual(['first', 'second']);

    await expect(deleteFact('fourth')).resolves.toEqual({});
  });

  it('sends commands one at a time in call order', async () => {
    const order: string[] = [];
    testHost.podCommand = async (c) => {
      order.push(`start ${c.args[0]}`);
      await new Promise((r) => setTimeout(r, c.args[0] === 'a' ? 20 : 0));
      order.push(`end ${c.args[0]}`);
      return {};
    };
    await Promise.all([deleteFact('a'), deleteFact('b')]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('returns', () => {
  it('resolves to the local row of the id the pod sent, once the sink has applied it', async () => {
    // The sink is the session: it applies the snapshot before it resolves.
    testHost.podCommand = async () => {
      await database.write(async () => {
        await database.get('persona_suppressions').create((r: any) => {
          r._raw.id = 'pod-row';
          r.pattern = 'from the pod';
          r.strength = 0.5;
          r.source = 'chat';
        });
      });
      return { id: 'pod-row' };
    };
    const model = await addSuppression({ pattern: 'ignored', strength: 0.5, source: 'chat' });
    expect(model.id).toBe('pod-row');
    expect((model as any).pattern).toBe('from the pod');
  });
});

describe('the topic delete window', () => {
  it('carries the caller\'s undoWindowMs to the pod', async () => {
    await deleteTopicWithDecline(ctx.topicId, { undoWindowMs: 15_000 });
    expect(sent[0].args).toEqual([ctx.topicId, { undoWindowMs: 15_000 }]);
  });
});

it('has an entry in COMMANDS for every wrapped writer and no other', () => {
  expect(Object.keys(COMMANDS).sort()).toEqual(registeredCommandNames());
});
