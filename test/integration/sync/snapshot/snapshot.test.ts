import database from '@/lib/database';
import { applySnapshot } from '@/lib/sync/apply';
import { SyncVersionError, SYNC_TABLES } from '@/lib/sync/tables';
import { buildSnapshot } from '@/lib/sync/snapshot';
import { resetDatabase } from '@/test/helpers';

import { PEER, REGISTRY, build, put, rows, setAll, settings } from './support';

const LOCAL = { registry: REGISTRY, schemaVersion: PEER.schemaVersion };

const fact = (id: string, statement: string) => ({ id, statement, created_at: 1, updated_at: 1 });
const note = (id: string, title: string, status: string) => ({ id, type: 'x', title, body: 'b', status, source: 's', created_at: 1 });

beforeEach(resetDatabase);

describe('build then apply', () => {
  it('makes the phone copy the served tables and leaves everything else alone', async () => {
    await put('facts', [fact('f1', 'pod fact')]);
    await put('conversations', [{ id: 'c-pod', surface: 'pod', created_at: 1 }]);
    await put('messages', [{ id: 'm-pod', conversation_id: 'c-pod', role: 'user', content: 'x', created_at: 1 }]);
    await setAll({ feed_metadata: 'pod-meta', app_language: 'de', theme: 'pod-theme', cached_user_id: 'pod-user' });
    const snap = await build();

    expect(Object.keys(snap.tables).sort()).toEqual(SYNC_TABLES.map((t) => t.name).sort());
    expect(Object.keys(snap.tables)).not.toContain('conversations');
    const served = snap.tables.settings.rows!.map((r) => r.key).sort();
    expect(served).toEqual(['app_language', 'feed_metadata']);

    await resetDatabase();
    await put('facts', [fact('f-old', 'phone fact')]);
    await put('conversations', [{ id: 'c-phone', surface: 'phone', created_at: 1 }]);
    await put('messages', [{ id: 'm-phone', conversation_id: 'c-phone', role: 'user', content: 'y', created_at: 1 }]);
    await setAll({ theme: 'phone-theme', cached_user_id: 'phone-user', app_language: 'en' });

    await applySnapshot(snap, { local: LOCAL });

    expect((await rows('facts')).map((r) => r.id)).toEqual(['f1']);
    expect((await rows('conversations')).map((r) => r.id)).toEqual(['c-phone']);
    expect((await rows('messages')).map((r) => r.id)).toEqual(['m-phone']);
    expect(await settings()).toEqual({
      theme: 'phone-theme',
      cached_user_id: 'phone-user',
      app_language: 'de',
      feed_metadata: 'pod-meta',
    });
  });

  it('removes a replace-table row that was deleted on the pod and an allowlisted setting the pod lacks', async () => {
    await put('facts', [fact('f1', 'one')]);
    const snap = await build();
    await resetDatabase();
    await put('facts', [fact('f1', 'one'), fact('f2', 'two')]);
    await setAll({ mera_skip_notes: 'x', theme: 't' });
    await applySnapshot(snap, { local: LOCAL });
    expect((await rows('facts')).map((r) => r.id)).toEqual(['f1']);
    expect(await settings()).toEqual({ theme: 't' });
  });

  it('leaves a skipped table untouched', async () => {
    await put('facts', [fact('f1', 'pod')]);
    await put('topics', [{ id: 't1', text: 'pod', normalized_text: 'pod', weight: 1, status: 'a', provenance: 'p', high_priority: false, created_at: 1, updated_at: 1 }]);
    const snap = await build();
    await resetDatabase();
    await put('facts', [fact('f-phone', 'phone')]);
    const applied = await applySnapshot(snap, { skip: new Set(['facts']), local: LOCAL });
    expect((await rows('facts')).map((r) => r.id)).toEqual(['f-phone']);
    expect((await rows('topics')).map((r) => r.id)).toEqual(['t1']);
    expect(Object.keys(applied)).not.toContain('facts');
    expect(Object.keys(applied)).toContain('topics');
  });
});

describe('hashes', () => {
  it('sends nothing for a table whose hash the phone already holds, and only the changed table after a write', async () => {
    await put('facts', [fact('f1', 'one')]);
    const first = await build();
    const hashes = Object.fromEntries(Object.entries(first.tables).map(([n, t]) => [n, t.hash]));

    const again = await build(hashes);
    expect(Object.values(again.tables).every((t) => t.rows === undefined)).toBe(true);

    await put('facts', [fact('f2', 'two')]);
    const changed = await build(hashes);
    const sent = Object.entries(changed.tables).filter(([, t]) => t.rows !== undefined).map(([n]) => n);
    expect(sent).toEqual(['facts']);
    expect(changed.tables.facts.hash).not.toBe(hashes.facts);
  });

  it('changes the settings hash when a served key changes and not when an unserved key does', async () => {
    await setAll({ feed_metadata: 'a', theme: 'x' });
    const a = await build();
    await setAll({ theme: 'y' });
    expect((await build()).tables.settings.hash).toBe(a.tables.settings.hash);
    await setAll({ feed_metadata: 'b' });
    expect((await build()).tables.settings.hash).not.toBe(a.tables.settings.hash);
  });
});

describe('notifications merge', () => {
  it('keeps phone-only rows and the phone status, and adds new pod rows', async () => {
    await put('notifications', [note('n1', 'pod title', 'unread'), note('n2', 'new', 'unread')]);
    const snap = await build();
    await resetDatabase();
    await put('notifications', [note('n1', 'old title', 'dismissed'), note('n3', 'phone only', 'unread')]);
    await applySnapshot(snap, { local: LOCAL });
    const got = Object.fromEntries((await rows('notifications')).map((r) => [r.id, r]));
    expect(Object.keys(got).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(got.n1.status).toBe('dismissed');
    expect(got.n1.title).toBe('pod title');
    expect(got.n2.status).toBe('unread');
    expect(got.n3.title).toBe('phone only');
  });
});

describe('versions', () => {
  it('refuses on the serving side and names the older side', async () => {
    await expect(buildSnapshot({ hashes: {}, registry: REGISTRY, peer: { ...PEER, schemaVersion: PEER.schemaVersion - 1 } }))
      .rejects.toMatchObject({ name: 'SyncVersionError', which: 'phone' });
    await expect(buildSnapshot({ hashes: {}, registry: REGISTRY, peer: { ...PEER, registry: REGISTRY + 1 } }))
      .rejects.toMatchObject({ which: 'server' });
  });

  it('refuses on the receiving side, names the older side and writes nothing', async () => {
    await put('facts', [fact('f1', 'pod')]);
    const snap = await build();
    await resetDatabase();
    await put('facts', [fact('f-phone', 'phone')]);

    for (const [patch, which] of [
      [{ schemaVersion: snap.schemaVersion + 1 }, 'server'],
      [{ schemaVersion: snap.schemaVersion - 1 }, 'phone'],
      [{ registry: REGISTRY + 1 }, 'server'],
      [{ registry: REGISTRY - 1 }, 'phone'],
    ] as const) {
      const err = await applySnapshot(snap, { local: { ...LOCAL, ...patch } }).catch((e) => e);
      expect(err).toBeInstanceOf(SyncVersionError);
      expect(err.which).toBe(which);
    }
    expect((await rows('facts')).map((r) => r.id)).toEqual(['f-phone']);
  });
});

describe('one writer', () => {
  it('leaves every table as it was when the apply fails part way', async () => {
    await put('facts', [fact('f1', 'pod')]);
    const snap = await build();
    // Two rows with one id: the second create must fail after the earlier tables were prepared.
    snap.tables.topics = { hash: 'h', mode: 'replace', rows: [
      { id: 'dup', text: 'a', normalized_text: 'a', weight: 1, status: 'a', provenance: 'p', high_priority: false, created_at: 1, updated_at: 1 },
      { id: 'dup', text: 'b', normalized_text: 'b', weight: 1, status: 'a', provenance: 'p', high_priority: false, created_at: 1, updated_at: 1 },
    ] };
    await resetDatabase();
    await put('facts', [fact('f-phone', 'phone')]);
    await put('topics', [{ id: 't-phone', text: 'p', normalized_text: 'p', weight: 1, status: 'a', provenance: 'p', high_priority: false, created_at: 1, updated_at: 1 }]);

    await expect(applySnapshot(snap, { local: LOCAL })).rejects.toThrow();
    expect((await rows('facts')).map((r) => r.id)).toEqual(['f-phone']);
    expect((await rows('topics')).map((r) => r.id)).toEqual(['t-phone']);
  });
});

describe('settings by kind', () => {
  it('serves the card state but never applies it on a phone', async () => {
    await setAll({ feed_card_state_v1: 'pod-cards', feed_metadata: 'm' });
    const snap = await build();
    expect(snap.tables.settings.rows!.map((r) => r.key)).toContain('feed_card_state_v1');

    await resetDatabase();
    await setAll({ feed_card_state_v1: 'my-cards' });
    await applySnapshot(snap, { local: LOCAL });
    expect(await settings()).toEqual({ feed_card_state_v1: 'my-cards', feed_metadata: 'm' });

    await resetDatabase();
    await applySnapshot(snap, { local: LOCAL });
    expect(await settings()).toEqual({ feed_metadata: 'm' });
  });
});

describe('notifications a phone deleted', () => {
  it('stay deleted, while a newer pod notification still arrives', async () => {
    await put('notifications', [note('n1', 'one', 'unread')]);
    const first = await build();
    await put('notifications', [{ ...note('n2', 'two', 'unread'), created_at: 50 }]);
    const second = await build();
    await resetDatabase();

    await applySnapshot(first, { local: LOCAL });
    expect((await rows('notifications')).map((r) => r.id)).toEqual(['n1']);
    const gone = await database.get('notifications').find('n1');
    await database.write(() => gone.destroyPermanently());

    await applySnapshot(second, { local: LOCAL });
    expect((await rows('notifications')).map((r) => r.id)).toEqual(['n2']);
  });

  it('a new pod notification stamped earlier than one already applied still arrives (the pod clock stepped back)', async () => {
    await put('notifications', [{ ...note('late', 'late', 'unread'), created_at: 9_000 }]);
    const first = await build();
    await put('notifications', [{ ...note('early', 'early', 'unread'), created_at: 1_000 }]);
    const second = await build();
    await resetDatabase();
    await applySnapshot(first, { local: LOCAL });
    await applySnapshot(second, { local: LOCAL });
    expect((await rows('notifications')).map((r) => r.id).sort()).toEqual(['early', 'late']);
  });
});

describe('unchanged rows', () => {
  it('are not rewritten by an apply', async () => {
    await put('facts', [fact('f1', 'one'), fact('f2', 'two')]);
    const snap = await build();
    snap.tables.facts.rows![1].statement = 'two, edited';
    await resetDatabase();
    await put('facts', [fact('f1', 'one'), fact('f2', 'two')]);
    const touched: string[] = [];
    const sub = database.withChangesForTables(['facts']).subscribe((changes) => {
      for (const c of changes ?? []) if (c.record) touched.push(c.record.id);
    });
    await applySnapshot(snap, { local: LOCAL });
    sub.unsubscribe();
    expect(touched).toEqual(['f2']);
  });
});

describe('settings in a snapshot from a careless server', () => {
  it('writes only applied keys, and neither replaces nor deletes any other key', async () => {
    const snap = await build();
    snap.tables.settings = { hash: 'h', mode: 'replace', rows: [
      { key: 'cached_user_id', value: 'pod-user' },
      { key: 'theme', value: 'pod-theme' },
      { key: 'app_language', value: 'fr' },
    ] };
    await resetDatabase();
    await setAll({ cached_user_id: 'phone-user', theme: 'phone-theme', developer_mode: 'on' });
    await applySnapshot(snap, { local: LOCAL });
    expect(await settings()).toEqual({ cached_user_id: 'phone-user', theme: 'phone-theme', developer_mode: 'on', app_language: 'fr' });
  });
});
