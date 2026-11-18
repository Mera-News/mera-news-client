import database from '@/lib/database';
import { createMarkBatch } from '@/lib/sync/marks';
import { createSyncSession } from '@/lib/sync/session';
import { deleteOlderThan } from '@/lib/database/services/notification-service';
import type { Snapshot } from '@/lib/sync/snapshot';
import { resetDatabase, testHost } from '@/test/helpers';

import { PEER, build, put, rows, setAll, settings } from './support';

const fact = (id: string, statement: string) => ({ id, statement, created_at: 1, updated_at: 1 });
const visit = { publicationName: 'P' } as any;

beforeEach(resetDatabase);
afterEach(() => { delete testHost.podCommand; });

/** A pod that answers from a snapshot captured up front. */
async function podWith(factRows: Record<string, unknown>[]) {
  await put('facts', factRows);
  const full = await build();
  const hashesOf = (s: Snapshot) => Object.fromEntries(Object.entries(s.tables).map(([n, t]) => [n, t.hash]));
  await resetDatabase();
  const answer = (hashes: Record<string, string>): Snapshot => ({
    ...full,
    tables: Object.fromEntries(
      Object.entries(full.tables).map(([n, t]) => [n, hashes[n] === t.hash ? { hash: t.hash, mode: t.mode } : t]),
    ),
  });
  return { answer, hashesOf, full };
}

describe('sync session', () => {
  it('starts from hashes the app kept, so a cold start pulls nothing that has not changed, and a wrong one only costs rows', async () => {
    const pod = await podWith([fact('f1', 'one')]);
    const kept = pod.hashesOf(pod.full);
    const requests: Record<string, string>[] = [];
    const session = createSyncSession({
      local: PEER, marks: createMarkBatch(), initialHashes: { ...kept, facts: 'stale' },
      send: async () => { throw new Error('no commands'); },
      pull: async (req) => { requests.push(req.hashes); return pod.answer(req.hashes); },
    });
    await session.syncNow();
    expect(requests[0]).toEqual({ ...kept, facts: 'stale' });
    // Only the table whose kept hash was wrong came back with rows, and it was applied.
    expect((await rows('facts')).map((r) => r.id)).toEqual(['f1']);
    expect(session.hashes().facts).toBe(kept.facts);
  });

  it('pulls the snapshot and remembers the applied hashes, so the next pull sends no rows', async () => {
    const pod = await podWith([fact('f1', 'one')]);
    const requests: Record<string, string>[] = [];
    const session = createSyncSession({
      local: PEER, marks: createMarkBatch(),
      send: async () => { throw new Error('no commands'); },
      pull: async (req) => { requests.push(req.hashes); return pod.answer(req.hashes); },
    });
    await session.syncNow();
    expect((await rows('facts')).map((r) => r.id)).toEqual(['f1']);
    await session.syncNow();
    expect(requests[0]).toEqual({});
    expect(requests[1].facts).toBe(pod.full.tables.facts.hash);
  });

  it('applies the snapshot that comes back with a command and does not pull', async () => {
    const pod = await podWith([fact('f1', 'one')]);
    let pulls = 0;
    const session = createSyncSession({
      local: PEER, marks: createMarkBatch(),
      send: async (_cmds, req) => ({ results: [{ ok: 'ok' }], snapshot: pod.answer(req.hashes) }),
      pull: async () => { pulls += 1; throw new Error('unexpected'); },
    });
    expect(await session.command('x', [1])).toBe('ok');
    expect(pulls).toBe(0);
    expect((await rows('facts')).map((r) => r.id)).toEqual(['f1']);
  });

  it('pulls when the command response carries no snapshot', async () => {
    const pod = await podWith([fact('f1', 'one')]);
    const session = createSyncSession({
      local: PEER, marks: createMarkBatch(),
      send: async () => ({ results: [{ ok: 1 }] }),
      pull: async (req) => pod.answer(req.hashes),
    });
    await session.command('x', []);
    expect((await rows('facts')).length).toBe(1);
  });

  it('sends marks first in the same request, and card state keeps only the latest value', async () => {
    const pod = await podWith([]);
    const marks = createMarkBatch();
    const sent: any[] = [];
    const session = createSyncSession({
      local: PEER, marks,
      send: async (cmds, req) => { sent.push(cmds); return { results: cmds.map(() => ({ ok: null })), snapshot: pod.answer(req.hashes) }; },
      pull: async (req) => pod.answer(req.hashes),
    });
    marks.recordMark('cardState', { a: 1 });
    marks.recordMark('cardState', { a: 2 });
    marks.recordMark('seen', 'story-1');
    await session.command('x', []);
    expect(sent[0].map((c: any) => c.name)).toEqual(['marks', 'x']);
    expect(sent[0][0].args[0]).toEqual({ opens: [], visits: [], seen: ['story-1'], watermarks: [], cardState: { a: 2 } });
    await session.tick();
    expect(sent.length).toBe(1);
  });

  it('leaves a table marked during a pull out of that apply and fetches it again', async () => {
    const pod = await podWith([fact('f1', 'one')]);
    const marks = createMarkBatch();
    const requests: Record<string, string>[] = [];
    await put('publication_visits', [{ id: 'v-local', publication_name: 'P', visited_at: 1 }]);
    let first = true;
    const session = createSyncSession({
      local: PEER, marks,
      send: async () => ({ results: [] }),
      pull: async (req) => {
        requests.push(req.hashes);
        if (first) { first = false; marks.recordMark('visit', visit); }
        return pod.answer(req.hashes);
      },
    });
    await session.syncNow();
    // publication_visits was marked mid-pull, facts was not
    expect((await rows('facts')).length).toBe(1);
    expect((await rows('publication_visits')).map((r) => r.id)).toEqual(['v-local']);
    await session.syncNow();
    expect(requests[1].publication_visits).toBeUndefined();
    expect(requests[1].facts).toBe(pod.full.tables.facts.hash);
  });

  it('clears a table hash when its marks go unsent', async () => {
    const pod = await podWith([]);
    const marks = createMarkBatch();
    const requests: Record<string, string>[] = [];
    const session = createSyncSession({
      local: PEER, marks,
      send: async () => { throw new Error('offline'); },
      pull: async (req) => { requests.push(req.hashes); return pod.answer(req.hashes); },
    });
    await session.syncNow();
    marks.recordMark('open', {} as any);
    await session.syncNow().catch(() => {});
    await session.syncNow();
    expect(requests.at(-1)!.story_impressions).toBeUndefined();
    expect(requests.at(-1)!.facts).toBeDefined();
  });

  it('does not start a pull while a command is in flight', async () => {
    const pod = await podWith([]);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const session = createSyncSession({
      local: PEER, marks: createMarkBatch(),
      send: async (_c, req) => { order.push('send-start'); await gate; order.push('send-end'); return { results: [{ ok: null }], snapshot: pod.answer(req.hashes) }; },
      pull: async (req) => { order.push('pull'); return pod.answer(req.hashes); },
    });
    const cmd = session.command('x', []);
    const pull = session.syncNow();
    release();
    await Promise.all([cmd, pull]);
    expect(order).toEqual(['send-start', 'send-end', 'pull']);
  });

  it('does not leave settings out of a pull because card state was marked', async () => {
    await setAll({ app_language: 'de' });
    const pod = await build();
    await resetDatabase();
    const marks = createMarkBatch();
    const session = createSyncSession({
      local: PEER, marks,
      send: async () => ({ results: [] }),
      pull: async () => { marks.recordMark('cardState', { a: 1 }); return pod; },
    });
    await session.syncNow();
    expect(await settings()).toEqual({ app_language: 'de' });
    expect(marks.hasPending()).toBe(true);
  });

  it('returns the ok value of a command, or throws its code and message after applying the snapshot', async () => {
    const pod = await podWith([fact('f1', 'one')]);
    const reply = (r: unknown) => async (_c: unknown, req: any) => ({ results: [r] as any, snapshot: pod.answer(req.hashes) });
    const ok = createSyncSession({ local: PEER, marks: createMarkBatch(), pull: async () => { throw new Error('no'); }, send: reply({ ok: { id: 'x' } }) });
    expect(await ok.command('x', [])).toEqual({ id: 'x' });

    const bad = createSyncSession({ local: PEER, marks: createMarkBatch(), pull: async () => { throw new Error('no'); },
      send: reply({ error: { code: 'nope', message: 'It failed' } }) });
    await expect(bad.command('x', [])).rejects.toMatchObject({ code: 'nope', message: 'It failed' });
    expect((await rows('facts')).length).toBe(1);
  });

  describe('stray writes', () => {
    const open = (onStrayWrite: (t: string) => void, marks = createMarkBatch()) => {
      testHost.podCommand = async () => null;
      return createSyncSession({ local: PEER, marks, onStrayWrite, send: async () => ({ results: [] }), pull: async () => { throw new Error('no'); } });
    };
    const writeFact = () => database.write(() => database.get('facts').create((r: any) => { r.statement = 's'; }));

    const oldNote = { id: 'n-old', type: 'x', title: 'old', body: 'b', status: 'unread', source: 's', created_at: 1 };

    it('a paired phone pruning old notifications is not stray, and the next pull does not bring them back', async () => {
      await put('notifications', [oldNote]);
      const full = await build();
      await resetDatabase();
      const stray: string[] = [];
      testHost.podCommand = async () => null;
      // The pod still holds the row and sends it every time.
      const session = createSyncSession({ local: PEER, marks: createMarkBatch(), onStrayWrite: (t) => stray.push(t), send: async () => ({ results: [] }), pull: async () => full });
      try {
        await session.syncNow();
        expect((await rows('notifications')).map((r) => r.id)).toEqual(['n-old']);
        expect(await deleteOlderThan(1_000)).toBe(1);
        await session.syncNow();
        expect(await rows('notifications')).toEqual([]);
        expect(stray).toEqual([]);
      } finally {
        session.stop();
      }
    });

    it('an update to a notification and a write to a replace table still report', async () => {
      await put('notifications', [oldNote]);
      const stray: string[] = [];
      const session = open((t) => stray.push(t));
      try {
        const [row] = await database.get('notifications').query().fetch();
        await database.write(() => row.update((r: any) => { r.title = 'changed on the phone'; }));
        await writeFact();
        expect([...stray].sort()).toEqual(['facts', 'notifications']);
      } finally {
        session.stop();
      }
    });

    it('reports a local write to a served table once, and not an apply', async () => {
      const pod = await podWith([fact('f1', 'one')]);
      const stray: string[] = [];
      const marks = createMarkBatch();
      testHost.podCommand = async () => null;
      const session = createSyncSession({ local: PEER, marks, onStrayWrite: (t) => stray.push(t), send: async () => ({ results: [] }), pull: async (req) => pod.answer(req.hashes) });
      await session.syncNow();
      expect(stray).toEqual([]);
      await writeFact();
      await writeFact();
      expect(stray).toEqual(['facts']);
    });

    it('ignores the mark tables, settings, and a host with no sink', async () => {
      const stray: string[] = [];
      open((t) => stray.push(t));
      await put('publication_visits', [{ id: 'v', publication_name: 'P', visited_at: 1 }]);
      await setAll({ app_language: 'de' });
      expect(stray).toEqual([]);
      delete testHost.podCommand;
      const quiet: string[] = [];
      createSyncSession({ local: PEER, marks: createMarkBatch(), onStrayWrite: (t) => quiet.push(t), send: async () => ({ results: [] }), pull: async () => { throw new Error('no'); } });
      await writeFact();
      expect(quiet).toEqual([]);
    });
  });
});
