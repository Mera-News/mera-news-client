import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { watermelonRowSource } from '../backup/adapters/watermelon-row-source';
import { orderForTable } from '../backup/export';
import appSchema from '../database/schema';
import { SYNC_TABLES, assertSameVersions, isSyncSettingKey, type SyncMode, type SyncPeer } from './tables';

const PAGE_ROWS = 500;

export interface SnapshotTable {
  readonly hash: string;
  readonly mode: SyncMode;
  /** Absent when the receiver already holds this hash. */
  readonly rows?: Record<string, unknown>[];
}

export interface Snapshot {
  readonly schemaVersion: number;
  readonly registry: number;
  readonly tables: Record<string, SnapshotTable>;
}

export interface BuildOptions {
  /** The hash the receiver holds for each table. */
  readonly hashes: Readonly<Record<string, string>>;
  readonly registry: number;
  /** The versions the receiver runs; a mismatch is refused. */
  readonly peer?: SyncPeer;
}

// `_status` and `_changed` are local bookkeeping, the same two columns a backup drops.
function toRow(raw: Record<string, unknown>): Record<string, unknown> {
  const { _status: _s, _changed: _c, $loki: _l, ...rest } = raw;
  return rest;
}

async function readAll(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE_ROWS) {
    const page = await watermelonRowSource.page({ table, orderBy: orderForTable(table), limit: PAGE_ROWS, offset });
    out.push(...page.map(toRow));
    if (page.length < PAGE_ROWS) return out;
  }
}

export async function buildSnapshot(options: BuildOptions): Promise<Snapshot> {
  const local = { schemaVersion: appSchema.version, registry: options.registry };
  if (options.peer) assertSameVersions(local, options.peer, 'server');

  const tables: Record<string, SnapshotTable> = {};
  // One reader for every table, so no child row is served without its parent.
  await watermelonRowSource.snapshot(async () => {
    for (const { name, mode } of SYNC_TABLES) {
      let rows = await readAll(name);
      if (name === 'settings') {
        rows = rows
          .filter((r) => isSyncSettingKey(String(r.key)))
          .map((r) => ({ key: r.key, value: r.value }))
          .sort((a, b) => String(a.key).localeCompare(String(b.key)));
      }
      const hash = bytesToHex(sha256(new TextEncoder().encode(rows.map((r) => JSON.stringify(r)).join('\n'))));
      tables[name] = hash === options.hashes[name] ? { hash, mode } : { hash, mode, rows };
    }
  });
  return { ...local, tables };
}
