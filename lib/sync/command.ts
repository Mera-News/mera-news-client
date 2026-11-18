// The seam between a registered writer and the pod. With a host sink the writer does not run here:
// its name and arguments go to the pod, and the pod's result comes back.

import database from '../database';
import { platform, type PlatformHost } from '../platform';

/** An integer, so the older side of a mismatch can be told. Bumped by hand whenever a command is added, removed or renamed; a hash test pins the names. */
export const COMMAND_REGISTRY_VERSION = 3;

export class CommandArgumentsError extends Error {
  constructor(readonly command: string, detail: string) {
    super(`Command ${command} cannot be sent: ${detail}`);
    this.name = 'CommandArgumentsError';
  }
}

export class CommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export type Command<A extends unknown[], R> = ((...args: A) => Promise<R>) & { local: (...args: A) => Promise<R> };

/**
 * How a writer's returned models cross the wire. The pod answers ids, and the caller gets the rows
 * the sink has applied by then. `many`: a list of models, answered as `{ ids }`. `path`: the models sit
 * under that key of the result, answered as `{ id }` in its place. A plain table name is `{ table }`.
 */
export interface CommandReturns {
  table: string;
  many?: true;
  path?: string;
}

interface CommandOptions<A extends unknown[], R> {
  returns?: string | CommandReturns;
  /** What goes to the pod when the call has arguments that only mean something here. */
  sendArgs?: (args: A) => unknown[];
  /** When it answers false the call runs here even with a sink. */
  when?: (...args: A) => boolean;
  /** Shapes the pod's result for the caller. */
  onResult?: (result: R) => R;
}

const names = new Set<string>();
const returnsOf = new Map<string, CommandReturns>();

/** The return shape a command was registered with, for the pod to turn its models into ids. */
export function commandReturns(name: string): CommandReturns | undefined {
  return returnsOf.get(name);
}

/** Every name given to command() so far. */
export function registeredCommandNames(): string[] {
  return [...names].sort();
}

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function jsonArgs(name: string, args: unknown[]): unknown[] {
  const sent = [...args];
  while (sent.length && sent[sent.length - 1] === undefined) sent.pop();
  let round: unknown;
  try {
    round = JSON.parse(JSON.stringify(sent));
  } catch (e) {
    throw new CommandArgumentsError(name, e instanceof Error ? e.message : String(e));
  }
  if (!sameJson(sent, round)) throw new CommandArgumentsError(name, 'the arguments are not plain JSON');
  return sent;
}

// One chain per process: commands leave one at a time in call order. `pending` lets a command that
// arrives after the chain drained start clean, whatever the last one did.
let tail: Promise<boolean> = Promise.resolve(true);
let pending = 0;

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const before = pending === 0 ? Promise.resolve(true) : tail;
  pending++;
  const mine = (async () => {
    try {
      if (!(await before)) throw new CommandError('earlier_change_failed', 'An earlier change failed, so this one was not sent');
      return await job();
    } finally {
      pending--;
    }
  })();
  tail = mine.then(() => true, () => false);
  return mine;
}

async function send<A extends unknown[], R>(
  sink: NonNullable<PlatformHost['podCommand']>,
  name: string,
  opts: CommandOptions<A, R> | undefined,
  args: A,
): Promise<R> {
  const sent = jsonArgs(name, opts?.sendArgs ? opts.sendArgs(args) : args);
  return enqueue(async () => {
    const result = await sink({ name, args: sent, registry: COMMAND_REGISTRY_VERSION });
    const returns = returnsOf.get(name);
    const shaped = returns ? await withModels(returns, result) : result;
    return (opts?.onResult ? opts.onResult(shaped as R) : shaped) as R;
  });
}

async function withModels(returns: CommandReturns, result: unknown): Promise<unknown> {
  const table = database.get(returns.table);
  if (returns.many) return Promise.all(((result as { ids: string[] }).ids ?? []).map((id) => table.find(id)));
  if (returns.path) {
    const at = result as Record<string, { id: string }>;
    return { ...at, [returns.path]: await table.find(at[returns.path].id) };
  }
  return table.find((result as { id: string }).id);
}

/**
 * Wraps a writer. With no `podCommand` on the host it is `fn`. With one, the call is sent to the
 * pod instead and `fn` never runs here. `returns` names the table of a model the writer returns:
 * the pod answers `{ id }` and the caller gets the row of that id, after the pull has brought it.
 */
export function command<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
  opts?: CommandOptions<A, R>,
): Command<A, R> {
  if (names.has(name)) throw new Error(`Command ${name} is registered twice`);
  names.add(name);
  if (opts?.returns) returnsOf.set(name, typeof opts.returns === 'string' ? { table: opts.returns } : opts.returns);
  // Not async: with no sink the caller gets fn's own promise, with no extra turn of the event loop.
  const wrapper = ((...args: A): Promise<R> => {
    const sink = platform('lib/sync/command').podCommand;
    if (!sink || opts?.when?.(...args) === false) return fn(...args);
    return send(sink, name, opts, args);
  }) as Command<A, R>;
  wrapper.local = fn;
  return wrapper;
}
