"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CommandError = exports.CommandArgumentsError = exports.COMMAND_REGISTRY_VERSION = void 0;
exports.command = command;
exports.commandReturns = commandReturns;
exports.registeredCommandNames = registeredCommandNames;
var _database = _interopRequireDefault(require("../database"));
var _platform = require("../platform");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The seam between a registered writer and the pod. With a host sink the writer does not run here:
// its name and arguments go to the pod, and the pod's result comes back.

/** An integer, so the older side of a mismatch can be told. Bumped by hand whenever a command is added, removed or renamed; a hash test pins the names. */
const COMMAND_REGISTRY_VERSION = exports.COMMAND_REGISTRY_VERSION = 2;
class CommandArgumentsError extends Error {
  constructor(command, detail) {
    super(`Command ${command} cannot be sent: ${detail}`);
    this.command = command;
    this.name = 'CommandArgumentsError';
  }
}
exports.CommandArgumentsError = CommandArgumentsError;
class CommandError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'CommandError';
  }
}

/**
 * How a writer's returned models cross the wire. The pod answers ids, and the caller gets the rows
 * the sink has applied by then. `many`: a list of models, answered as `{ ids }`. `path`: the models sit
 * under that key of the result, answered as `{ id }` in its place. A plain table name is `{ table }`.
 */
exports.CommandError = CommandError;
const names = new Set();
const returnsOf = new Map();

/** The return shape a command was registered with, for the pod to turn its models into ids. */
function commandReturns(name) {
  return returnsOf.get(name);
}

/** Every name given to command() so far. */
function registeredCommandNames() {
  return [...names].sort();
}
function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter(k => a[k] !== undefined);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => sameJson(a[k], b[k]));
}
function jsonArgs(name, args) {
  const sent = [...args];
  while (sent.length && sent[sent.length - 1] === undefined) sent.pop();
  let round;
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
let tail = Promise.resolve(true);
let pending = 0;
function enqueue(job) {
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
async function send(sink, name, opts, args) {
  const sent = jsonArgs(name, opts?.sendArgs ? opts.sendArgs(args) : args);
  return enqueue(async () => {
    const result = await sink({
      name,
      args: sent,
      registry: COMMAND_REGISTRY_VERSION
    });
    const returns = returnsOf.get(name);
    const shaped = returns ? await withModels(returns, result) : result;
    return opts?.onResult ? opts.onResult(shaped) : shaped;
  });
}
async function withModels(returns, result) {
  const table = _database.default.get(returns.table);
  if (returns.many) return Promise.all((result.ids ?? []).map(id => table.find(id)));
  if (returns.path) {
    const at = result;
    return {
      ...at,
      [returns.path]: await table.find(at[returns.path].id)
    };
  }
  return table.find(result.id);
}

/**
 * Wraps a writer. With no `podCommand` on the host it is `fn`. With one, the call is sent to the
 * pod instead and `fn` never runs here. `returns` names the table of a model the writer returns:
 * the pod answers `{ id }` and the caller gets the row of that id, after the pull has brought it.
 */
function command(name, fn, opts) {
  if (names.has(name)) throw new Error(`Command ${name} is registered twice`);
  names.add(name);
  if (opts?.returns) returnsOf.set(name, typeof opts.returns === 'string' ? {
    table: opts.returns
  } : opts.returns);
  // Not async: with no sink the caller gets fn's own promise, with no extra turn of the event loop.
  const wrapper = (...args) => {
    const sink = (0, _platform.platform)('lib/sync/command').podCommand;
    if (!sink || opts?.when?.(...args) === false) return fn(...args);
    return send(sink, name, opts, args);
  };
  wrapper.local = fn;
  return wrapper;
}