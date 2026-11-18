import database from '../database';
import logger from '../logger';
import { platform } from '../platform';
import { applySnapshot } from './apply';
import { CommandError } from './command';
import { defaultMarkBatch, type MarkBatch } from './marks';
import type { Snapshot } from './snapshot';
import { MARK_TABLES, SYNC_TABLES, type SyncPeer } from './tables';

export interface SyncCommand {
  name: string;
  args: unknown[];
}

/** What a pull or a command carries: the hashes held and the versions run. */
/** One answer per command, in order. */
export type CommandResult = { ok: unknown } | { error: { code: string; message: string } };

export interface SyncRequest extends SyncPeer {
  hashes: Record<string, string>;
}

export interface SyncSessionOptions {
  /** The versions this side runs. */
  local: SyncPeer;
  /** The app supplies both calls. `send` answers with results and, when tables changed, a snapshot. */
  send(commands: SyncCommand[], request: SyncRequest): Promise<{ results: CommandResult[]; snapshot?: Snapshot }>;
  pull(request: SyncRequest): Promise<Snapshot>;
  marks?: MarkBatch;
  /** The hashes the app kept from the last applied snapshot, so a cold start pulls only what changed.
   *  A wrong one costs nothing but rows: the server sends a table whenever its hash differs. */
  initialHashes?: Record<string, string>;
  /** Called once per table when a local write to it lands outside an apply while a pod is paired. */
  onStrayWrite?(table: string): void;
}

/** The mark tick the app drives while in front. */
export const MARKS_TICK_MS = 10_000;

export function createSyncSession(options: SyncSessionOptions) {
  const marks = options.marks ?? defaultMarkBatch;
  const { local } = options;
  const known: Record<string, string> = { ...options.initialHashes };
  let touched = new Set<string>();
  let queue: Promise<unknown> = Promise.resolve();

  // A table with a mark the server has not seen can no longer be trusted to match its remembered hash.
  marks.onMark((tables) => {
    for (const t of tables) {
      touched.add(t);
      delete known[t];
    }
  });

  // With a pod paired, a local write to a served table is replaced by the next pull, so it is a bug.
  let applying = false;
  const MERGE_TABLES = new Set(SYNC_TABLES.filter((t) => t.mode === 'merge').map((t) => t.name));
  const strayTables = SYNC_TABLES.map((t) => t.name).filter(
    (n) => n !== 'settings' && !(Object.values(MARK_TABLES) as string[]).includes(n),
  );
  // Watched from the start and judged when a change arrives: the app sets the sink after it creates
  // the session, since the sink is this session's `command`.
  const reported = new Set<string>();
  const watch = database.withChangesForTables(strayTables).subscribe((changes) => {
      if (applying || !changes?.length || !platform('lib/sync/session').podCommand) return;
      for (const { record, type } of changes) {
        const table = (record.constructor as { table: string }).table;
        // A row the phone deletes from a merge table stays deleted (the merge never re-adds it), so a
        // prune is safe. A create or an update there, or any write to a replace table, is not.
        if (type === 'destroyed' && MERGE_TABLES.has(table)) continue;
        if (reported.has(table)) continue;
        reported.add(table);
        logger.warn(`a local write to ${table} in pod mode will be replaced by the next pull`);
        options.onStrayWrite?.(table);
      }
    });

  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  async function exchange(commands: SyncCommand[]): Promise<CommandResult[]> {
    const { batch } = marks.takeBatch();
    if (batch) commands = [{ name: 'marks', args: [batch] }, ...commands];
    touched = new Set(marks.pendingTables());
    for (const t of touched) delete known[t];
    const request: SyncRequest = { ...local, hashes: { ...known } };
    let snapshot: Snapshot | undefined;
    let results: CommandResult[] = [];
    if (commands.length) ({ results, snapshot } = await options.send(commands, request));
    snapshot ??= await options.pull(request);
    applying = true;
    let applied: Record<string, string>;
    try {
      applied = await applySnapshot(snapshot, { skip: touched, local });
    } finally {
      applying = false;
    }
    Object.assign(known, applied);
    for (const t of touched) delete known[t];
    return batch ? results.slice(1) : results;
  }

  return {
    /** Flushes marks, then pulls (or applies the snapshot that came back with them). */
    syncNow: (): Promise<void> => serial(async () => void (await exchange([]))),
    /** Runs one command after any marks, in one round trip, and applies the snapshot with it. */
    command: (name: string, args: unknown[]): Promise<unknown> =>
      serial(async () => {
        const [result] = await exchange([{ name, args }]);
        if (!result) throw new CommandError('no_result', `The server sent no result for ${name}`);
        if ('error' in result) throw new CommandError(result.error.code, result.error.message);
        return result.ok;
      }),
    /** Called every MARKS_TICK_MS while the app is in front. */
    tick: (): Promise<void> => (marks.hasPending() ? serial(async () => void (await exchange([]))) : Promise.resolve()),
    hashes: (): Record<string, string> => ({ ...known }),
    /** Stops watching for stray writes; call it when the phone leaves pod mode. */
    stop: (): void => watch.unsubscribe(),
  };
}
