// Pairing erases the phone: one writer applies the pod's first snapshot, empties every table the keep
// list does not name, and keeps only the device's own settings. All or nothing.
import database from '@/lib/database';
import appSchema from '@/lib/database/schema';
import { applySnapshot } from '@/lib/sync/apply';
import { PAIRING_ERASED_KEY, PAIRING_KEEP_SETTING_KEYS } from '@/lib/sync/tables';
import { resetDatabase } from '@/test/helpers';

import { PEER, REGISTRY, build, put, rawRows, rows, setAll, settings } from './support';

const LOCAL = { registry: REGISTRY, schemaVersion: PEER.schemaVersion };
const TABLES = Object.keys(appSchema.tables).filter((t) => t !== 'settings');

beforeEach(resetDatabase);

/** One phone row in every table, and the phone's settings: some the device keeps, some it loses. */
async function plantPhone() {
  for (const table of TABLES) await put(table, [{ id: `phone-${table}`, created_at: 1, updated_at: 1 }]);
  await setAll({
    has_launched: 'true',
    cached_user_id: 'phone-user',
    theme: 'dark',
    text_scale: '1.2',
    backup_provider: 'icloud',
    tutorial_feed_done: 'true',
    app_language: 'nl',
    feed_card_state_v1: '{"a":1}',
    feed_order_v1: '["x"]',
    onboarding_done: 'false',
  });
}

async function podSnapshot() {
  await put('facts', [{ id: 'pod-fact', statement: 'Follows chess', created_at: 1, updated_at: 1 }]);
  await put('notifications', [{ id: 'pod-note', type: 'x', title: 't', body: 'b', status: 'unread', source: 's', created_at: 1 }]);
  await setAll({ app_language: 'en', feed_metadata: 'pod-meta' });
  const snap = await build();
  await resetDatabase();
  return snap;
}

const erase = { keepTables: ['user_personas'], keepSettingKeys: ['tutorial_feed_done'] };

it('leaves only the pod\'s rows, the kept table and the kept settings, and marks that the erase happened', async () => {
  const snap = await podSnapshot();
  await plantPhone();

  await applySnapshot(snap, { local: LOCAL, erase });

  for (const table of TABLES) {
    const ids = (await rows(table)).map((r) => r.id);
    if (table === 'user_personas') expect(ids).toEqual(['phone-user_personas']);
    else if (table === 'facts') expect(ids).toEqual(['pod-fact']);
    else if (table === 'notifications') expect(ids).toEqual(['pod-note']);
    else expect([table, ids]).toEqual([table, []]);
  }
  const kept = await settings();
  expect(kept).toEqual({
    has_launched: 'true',
    cached_user_id: 'phone-user',
    theme: 'dark',
    text_scale: '1.2',
    backup_provider: 'icloud',
    tutorial_feed_done: 'true',
    app_language: 'en',
    feed_metadata: 'pod-meta',
    onboarding_done: 'true',
    [PAIRING_ERASED_KEY]: expect.any(String),
  });
});

it('keeps the identity, session and display settings by default', () => {
  for (const key of ['has_launched', 'cached_user_id', 'needs_reauth', 'theme', 'text_scale', 'blur_images', 'startup_tab', 'feed_view', 'backup_provider']) {
    expect(PAIRING_KEEP_SETTING_KEYS).toContain(key);
  }
  for (const key of ['app_language', 'feed_card_state_v1', 'onboarding_done']) expect(PAIRING_KEEP_SETTING_KEYS).not.toContain(key);
});

it('changes nothing when the write fails part way', async () => {
  const snap = await podSnapshot();
  await plantPhone();
  const before = await Promise.all([...TABLES, 'settings'].map(rawRows));
  const batch = jest.spyOn(database.adapter, 'batch').mockRejectedValueOnce(new Error('disk full'));

  await expect(applySnapshot(snap, { local: LOCAL, erase })).rejects.toThrow('disk full');

  batch.mockRestore();
  expect(await Promise.all([...TABLES, 'settings'].map(rawRows))).toEqual(before);
});

it('refuses a snapshot that lacks a served table, before erasing anything', async () => {
  const snap = await podSnapshot();
  delete (snap.tables.facts as { rows?: unknown }).rows;
  await plantPhone();
  const before = await Promise.all([...TABLES, 'settings'].map(rawRows));

  await expect(applySnapshot(snap, { local: LOCAL, erase })).rejects.toThrow(/facts/);

  expect(await Promise.all([...TABLES, 'settings'].map(rawRows))).toEqual(before);
});
