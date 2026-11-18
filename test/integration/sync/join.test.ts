// The phone side of pod mode end to end: a registered writer whose sink is the real sync session,
// marks recorded by a real mark writer, the snapshot that comes back applied, the writer's model
// returned from the applied rows, and the stray-write check quiet for all of it. The pod is a
// captured snapshot; the pod running the command is covered where a real pod runs.
import database from '@/lib/database';
import { createTopics } from '@/lib/database/services/topic-service';
import { recordOpen } from '@/lib/database/services/story-impression-service';
import { COMMAND_REGISTRY_VERSION } from '@/lib/sync/command';
import { createMarkBatch, defaultMarkBatch } from '@/lib/sync/marks';
import { createSyncSession, type SyncCommand } from '@/lib/sync/session';
import type { Snapshot } from '@/lib/sync/snapshot';
import appSchema from '@/lib/database/schema';
import { resetDatabase, testHost } from '@/test/helpers';

import { build, put, rows } from './snapshot/support';

const LOCAL = { schemaVersion: appSchema.version, registry: COMMAND_REGISTRY_VERSION };

beforeEach(resetDatabase);
afterEach(() => {
  delete testHost.podCommand;
});

it('a topic added on a paired phone runs on the pod, comes back in one round trip, and the caller gets the pod row', async () => {
  // The pod's state after it ran the command: the fact and the topic it created, with the pod's ids.
  await put('facts', [{ id: 'f1', statement: 'Lives in Utrecht', created_at: 1, updated_at: 1 }]);
  await put('topics', [{ id: 'pod-topic-1', fact_id: 'f1', text: 'utrecht trams', normalized_text: 'utrecht trams', weight: 0.6, status: 'active', created_at: 2, updated_at: 2 }]);
  // The open the phone sent in `marks`, as the pod recorded it, under the pod's id.
  await put('story_impressions', [{ id: 'pod-open-1', article_id: 'a1', surface: 'feed', opened: true, first_seen_at: 3, last_seen_at: 3, seen_count: 1 }]);
  const after = await build({}, LOCAL);
  await resetDatabase();

  const sent: { commands: SyncCommand[]; hashes: Record<string, string> }[] = [];
  const stray: string[] = [];
  const session = createSyncSession({
    local: LOCAL,
    marks: defaultMarkBatch,
    onStrayWrite: (table) => stray.push(table),
    send: async (commands, request) => {
      sent.push({ commands, hashes: request.hashes });
      const results = commands.map((c) => (c.name === 'createTopics' ? { ok: { ids: ['pod-topic-1'] } } : { ok: null }));
      return { results, snapshot: after as Snapshot };
    },
    pull: async () => {
      throw new Error('a command that brings a snapshot needs no pull');
    },
  });
  testHost.podCommand = ({ name, args }) => session.command(name, args);
  try {
    // A real mark writer: written locally, held for the next exchange.
    await recordOpen({ articleId: 'a1', surface: 'feed' });

    const made = await createTopics([{ factId: 'f1', text: 'Utrecht trams', weight: 0.6 }]);

    // One request: the marks first, then the command, with the phone's args as JSON.
    expect(sent).toHaveLength(1);
    expect(sent[0].commands.map((c) => c.name)).toEqual(['marks', 'createTopics']);
    expect((sent[0].commands[0].args[0] as { opens: unknown[] }).opens).toEqual([{ articleId: 'a1', surface: 'feed' }]);
    // The phone wrote no topic of its own; the one it holds is the pod's, from the snapshot.
    expect((await rows('topics')).map((r) => r.id)).toEqual(['pod-topic-1']);
    expect(made.map((t) => t.id)).toEqual(['pod-topic-1']);
    expect(made[0].text).toBe('utrecht trams');
    // The open was written on the phone at once (a mark is local first); the answer carries the
    // pod's copy of it, which replaces the phone's. Nothing tripped the check.
    expect((await rows('story_impressions')).map((r) => [r.id, r.article_id])).toEqual([['pod-open-1', 'a1']]);
    expect(stray).toEqual([]);

    // A write that skips the commands is reported.
    await database.write(() => database.get('facts').create((r: any) => { r.statement = 'written on the phone'; }));
    expect(stray).toEqual(['facts']);
  } finally {
    session.stop();
  }
});

it('a failed command leaves the phone as it was and the next command queued behind it is not sent', async () => {
  const sent: string[] = [];
  const session = createSyncSession({
    local: LOCAL,
    marks: createMarkBatch(),
    send: async (commands) => {
      sent.push(...commands.map((c) => c.name));
      return { results: commands.map(() => ({ error: { code: 'failed', message: 'The pod could not do that.' } })) };
    },
    pull: async () => build({}, LOCAL),
  });
  testHost.podCommand = ({ name, args }) => session.command(name, args);
  try {
    const [first, second] = await Promise.allSettled([
      createTopics([{ factId: 'f1', text: 'one', weight: 0.6 }]),
      createTopics([{ factId: 'f1', text: 'two', weight: 0.6 }]),
    ]);
    expect(first).toMatchObject({ status: 'rejected', reason: { code: 'failed' } });
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'earlier_change_failed' } });
    expect(sent).toEqual(['createTopics']);
    expect(await rows('topics')).toEqual([]);
  } finally {
    session.stop();
  }
});
