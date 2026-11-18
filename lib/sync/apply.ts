import { Q } from '@nozbe/watermelondb';
import type Model from '@nozbe/watermelondb/Model';
import { sanitizedRaw } from '@nozbe/watermelondb/RawRecord';

import database from '../database';
import type { Snapshot } from './snapshot';
import {
  PAIRING_ERASED_KEY,
  PAIRING_KEEP_SETTING_KEYS,
  PAIRING_KEEP_TABLES,
  SYNC_TABLES,
  assertSameVersions,
  isAppliedSettingKey,
  type SyncPeer,
} from './tables';

// Whatever a server sends, only these are ever written: a phone's own tables (its chats among them) are not.
const SYNCED = new Set(SYNC_TABLES.map((t) => t.name));

// Local to the phone and never served: the ids of the notifications the last applied snapshot held.
// A served row the phone lacks but has seen before was deleted on the phone. Ids, not times: the
// pod stamps a notification with its wall clock, which can step back.
const NOTIFICATIONS_SEEN_KEY = 'sync_notifications_seen';

export interface ApplyOptions {
  /** Tables left untouched, because they changed locally while the snapshot was in flight. */
  readonly skip?: ReadonlySet<string>;
  /** The versions this side runs. */
  readonly local: SyncPeer;
  /**
   * Pairing: erase the phone in the same writer. Every table but the kept ones is emptied or
   * replaced by the snapshot, settings keep only the kept keys and the ones served, and
   * `onboarding_done` and the erase marker are written. Added to the defaults in `tables.ts`.
   */
  readonly erase?: { readonly keepTables?: readonly string[]; readonly keepSettingKeys?: readonly string[] };
}

const collection = (table: string) => database.get<Model>(table as Parameters<typeof database.get>[0]);

/**
 * Applies every changed table in one writer and one batch, so a failure leaves all of them as they were.
 * Returns the hash of each table it applied.
 */
export async function applySnapshot(snapshot: Snapshot, options: ApplyOptions): Promise<Record<string, string>> {
  assertSameVersions(options.local, snapshot, 'phone');
  const applied: Record<string, string> = {};
  assertRowsUsable(snapshot);
  const erase = options.erase;
  // An erase replaces every served table, so a snapshot missing one would leave it empty.
  if (erase) for (const t of SYNC_TABLES) if (!snapshot.tables[t.name]?.rows) throw new Error(`Snapshot has no rows for ${t.name}, so the phone cannot be erased`);
  const keepTables = new Set([...PAIRING_KEEP_TABLES, ...(erase?.keepTables ?? [])]);
  const keepKeys = new Set([...PAIRING_KEEP_SETTING_KEYS, ...(erase?.keepSettingKeys ?? [])]);
  // Written by an erase, whatever the phone held.
  const written: Record<string, string> = erase ? { onboarding_done: 'true', [PAIRING_ERASED_KEY]: String(Date.now()) } : {};

  await database.write(async () => {
    const prepared: Model[] = [];
    for (const [name, table] of Object.entries(snapshot.tables)) {
      if (!table.rows || (!erase && options.skip?.has(name)) || !SYNCED.has(name)) continue;
      // Erasing, the pod's rows are the whole table: no merge, and no row held back as seen.
      const mode = erase ? 'replace' : table.mode;
      const col = collection(name);
      let seen = new Set<string>();
      if (name === 'notifications') {
        const [mark] = await collection('settings').query(Q.where('key', NOTIFICATIONS_SEEN_KEY)).fetch();
        const before = (mark as unknown as { value?: string } | undefined)?.value;
        try {
          seen = new Set(before && !erase ? (JSON.parse(before) as string[]) : []);
        } catch {
          seen = new Set();
        }
        const now = JSON.stringify(table.rows.map((r) => String(r.id)).sort());
        if (!mark) prepared.push(collection('settings').prepareCreate((rec) => { (rec as any).key = NOTIFICATIONS_SEEN_KEY; (rec as any).value = now; }));
        else if (before !== now) prepared.push(mark.prepareUpdate((rec) => { (rec as any).value = now; }));
      }
      const existing = await col.query().fetch();
      const create = (row: Record<string, unknown>) =>
        col.prepareCreate((rec) => {
          rec._raw = sanitizedRaw({ ...row, _status: 'created', _changed: '' }, col.schema);
        });

      if (name === 'settings') {
        const keep = new Map(table.rows.filter((r) => isAppliedSettingKey(String(r.key))).map((r) => [String(r.key), r.value]));
        for (const [key, value] of Object.entries(written)) keep.set(key, value);
        for (const rec of existing as unknown as { key: string; value: string }[]) {
          if (rec.key === NOTIFICATIONS_SEEN_KEY) continue;
          if (!isAppliedSettingKey(rec.key) && !(rec.key in written)) {
            if (erase && !keepKeys.has(rec.key)) prepared.push((rec as unknown as Model).prepareDestroyPermanently());
            continue;
          }
          const model = rec as unknown as Model;
          if (!keep.has(rec.key)) prepared.push(model.prepareDestroyPermanently());
          else {
            const value = String(keep.get(rec.key));
            if (rec.value !== value) prepared.push(model.prepareUpdate((r) => { (r as any).value = value; }));
            keep.delete(rec.key);
          }
        }
        for (const [key, value] of keep) prepared.push(create({ key, value: String(value) }));
      } else {
        // Rows are matched by id: a row both sides hold is updated, never destroyed and recreated.
        // A merge table keeps the phone's own `status` and every phone-only row.
        const byId = new Map(existing.map((m) => [m.id, m]));
        const served = new Set(table.rows.map((r) => String(r.id)));
        for (const row of table.rows) {
          const have = byId.get(String(row.id));
          // A pod row older than the last applied snapshot that the phone lacks was deleted on the phone.
          if (!have) {
            if (!(name === 'notifications' && seen.has(String(row.id)))) prepared.push(create(row));
          }
          else {
            const next = sanitizedRaw({ ...row, id: have.id }, col.schema) as Record<string, unknown>;
            const changed = Object.keys(next).filter(
              (k) => !['id', '_status', '_changed'].includes(k) && !(mode === 'merge' && k === 'status') && next[k] !== (have._raw as any)[k],
            );
            if (changed.length) prepared.push(have.prepareUpdate((rec) => { for (const k of changed) (rec._raw as any)[k] = next[k]; }));
          }
        }
        if (mode === 'replace') for (const m of existing) if (!served.has(m.id)) prepared.push(m.prepareDestroyPermanently());
      }
      applied[name] = table.hash;
    }
    // The phone's own tables (chats, jobs, the translation cache): emptied, not replaced.
    if (erase) {
      for (const name of Object.keys(database.schema.tables)) {
        if (SYNCED.has(name) || keepTables.has(name)) continue;
        for (const m of await collection(name).query().fetch()) prepared.push(m.prepareDestroyPermanently());
      }
    }
    await database.batch(...prepared);
  }, 'sync-apply');

  return applied;
}

// Checked before anything is prepared, so a bad snapshot fails with every table untouched.
function assertRowsUsable(snapshot: Snapshot): void {
  for (const [name, table] of Object.entries(snapshot.tables)) {
    if (!table.rows || name === 'settings' || !SYNCED.has(name)) continue;
    const ids = new Set<string>();
    for (const row of table.rows) {
      if (typeof row.id !== 'string' || row.id === '' || ids.has(row.id)) throw new Error(`Snapshot table ${name} has a missing or repeated row id`);
      ids.add(row.id);
    }
  }
}
