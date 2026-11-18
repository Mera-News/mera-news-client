"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MARKS_TICK_MS = void 0;
exports.createSyncSession = createSyncSession;
var _database = _interopRequireDefault(require("../database"));
var _logger = _interopRequireDefault(require("../logger"));
var _platform = require("../platform");
var _apply = require("./apply");
var _command = require("./command");
var _marks = require("./marks");
var _tables = require("./tables");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/** What a pull or a command carries: the hashes held and the versions run. */
/** One answer per command, in order. */

/** The mark tick the app drives while in front. */
const MARKS_TICK_MS = exports.MARKS_TICK_MS = 10_000;
function createSyncSession(options) {
  const marks = options.marks ?? _marks.defaultMarkBatch;
  const {
    local
  } = options;
  const known = {};
  let touched = new Set();
  let queue = Promise.resolve();

  // A table with a mark the server has not seen can no longer be trusted to match its remembered hash.
  marks.onMark(tables => {
    for (const t of tables) {
      touched.add(t);
      delete known[t];
    }
  });

  // With a pod paired, a local write to a served table is replaced by the next pull, so it is a bug.
  let applying = false;
  const strayTables = _tables.SYNC_TABLES.map(t => t.name).filter(n => n !== 'settings' && !Object.values(_tables.MARK_TABLES).includes(n));
  // Watched from the start and judged when a change arrives: the app sets the sink after it creates
  // the session, since the sink is this session's `command`.
  const reported = new Set();
  const watch = _database.default.withChangesForTables(strayTables).subscribe(changes => {
    if (applying || !changes?.length || !(0, _platform.platform)('lib/sync/session').podCommand) return;
    for (const {
      record
    } of changes) {
      const table = record.constructor.table;
      if (reported.has(table)) continue;
      reported.add(table);
      _logger.default.warn(`a local write to ${table} in pod mode will be replaced by the next pull`);
      options.onStrayWrite?.(table);
    }
  });
  const serial = work => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  async function exchange(commands) {
    const {
      batch
    } = marks.takeBatch();
    if (batch) commands = [{
      name: 'marks',
      args: [batch]
    }, ...commands];
    touched = new Set(marks.pendingTables());
    for (const t of touched) delete known[t];
    const request = {
      ...local,
      hashes: {
        ...known
      }
    };
    let snapshot;
    let results = [];
    if (commands.length) ({
      results,
      snapshot
    } = await options.send(commands, request));
    snapshot ??= await options.pull(request);
    applying = true;
    let applied;
    try {
      applied = await (0, _apply.applySnapshot)(snapshot, {
        skip: touched,
        local
      });
    } finally {
      applying = false;
    }
    Object.assign(known, applied);
    for (const t of touched) delete known[t];
    return batch ? results.slice(1) : results;
  }
  return {
    /** Flushes marks, then pulls (or applies the snapshot that came back with them). */
    syncNow: () => serial(async () => void (await exchange([]))),
    /** Runs one command after any marks, in one round trip, and applies the snapshot with it. */
    command: (name, args) => serial(async () => {
      const [result] = await exchange([{
        name,
        args
      }]);
      if (!result) throw new _command.CommandError('no_result', `The server sent no result for ${name}`);
      if ('error' in result) throw new _command.CommandError(result.error.code, result.error.message);
      return result.ok;
    }),
    /** Called every MARKS_TICK_MS while the app is in front. */
    tick: () => marks.hasPending() ? serial(async () => void (await exchange([]))) : Promise.resolve(),
    hashes: () => ({
      ...known
    }),
    /** Stops watching for stray writes; call it when the phone leaves pod mode. */
    stop: () => watch.unsubscribe()
  };
}