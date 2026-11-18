// One in-memory database plays both ends in turn: build on the "pod", copy the result through JSON,
// reset, seed the "phone", apply.
import database from '@/lib/database';
import { watermelonRowSink } from '@/lib/backup/adapters/watermelon-row-sink';
import appSchema from '@/lib/database/schema';
import { setSetting } from '@/lib/database/services/setting-service';
import { COMMAND_REGISTRY_VERSION } from '@/lib/sync/command';
import { buildSnapshot, type Snapshot } from '@/lib/sync/snapshot';
import type { SyncPeer } from '@/lib/sync/tables';

export const REGISTRY = COMMAND_REGISTRY_VERSION;
export const PEER: SyncPeer = { schemaVersion: appSchema.version, registry: REGISTRY };

export async function put(table: string, rows: Record<string, unknown>[]): Promise<void> {
  await watermelonRowSink.createRows(table, rows);
}

export async function rows(table: string): Promise<Record<string, any>[]> {
  const raws = (await database.get(table as never).query().unsafeFetchRaw()) as Record<string, any>[];
  return raws.map(({ _status, _changed, $loki, ...r }) => r).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** The settings, without the phone's own record of which notifications it has seen. */
export async function settings(): Promise<Record<string, string>> {
  return Object.fromEntries((await rows('settings')).filter((r) => r.key !== 'sync_notifications_seen').map((r) => [r.key, r.value]));
}

export async function setAll(map: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(map)) await setSetting(k, v);
}

export async function build(hashes: Record<string, string> = {}, peer: SyncPeer = PEER): Promise<Snapshot> {
  const snap = await buildSnapshot({ hashes, registry: REGISTRY, peer });
  return JSON.parse(JSON.stringify(snap));
}


export async function rawRows(table: string): Promise<Record<string, any>[]> {
  const raws = (await database.get(table as never).query().unsafeFetchRaw()) as Record<string, any>[];
  return raws.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
