"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.restoreWasInterrupted = restoreWasInterrupted;
exports.watermelonRowSink = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _RawRecord = require("@nozbe/watermelondb/RawRecord");
var _database = _interopRequireDefault(require("../../database"));
var _settingService = require("../../database/services/setting-service");
var _types = require("../types");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The `RowSink` port over WatermelonDB.
//
// Three things here are load-bearing and none of them are obvious.
//
// 1. **`sanitizedRaw` rather than `Object.assign(record._raw, row)`.** The rows
//    come out of a file, and a file is not a trusted type system. `sanitizedRaw`
//    coerces every column to the type `schema.ts` declares and fills a default
//    for anything absent, so a string where the schema wants a number becomes a
//    number instead of poisoning every later read of that column. Assigning
//    into `_raw` directly skips exactly that.
//
// 2. **`id` is carried, `_status` and `_changed` are not.** The row id is
//    load-bearing across tables — `article_suggestions` seeds it from the server
//    `_id` and `messages.conversation_id` points at `conversations.id` — so a
//    restore that regenerates ids silently severs every relationship. The sync
//    columns are reset to a fresh `created` state, which is correct for a device
//    that has never synced these rows.
//
// 3. **`settings` is upserted by key and never cleared.** Wiping the table
//    would take `cached_user_id`, `needs_reauth` and the PIN preference with it.
//    Those belong to the device the restore is landing ON.
//
// Importing `@/lib/database` constructs the SQLite adapter at module
// evaluation, so this file is native-coupled and the backup core never imports
// it.

function collection(table) {
  return _database.default.get(table);
}
const watermelonRowSink = exports.watermelonRowSink = {
  async beginRestore() {
    await (0, _settingService.setSetting)(_types.RESTORE_IN_PROGRESS_KEY, String(Date.now()));
  },
  async clearTables(tables) {
    // One write block per table rather than one for all of them: a single
    // transaction spanning 20 `destroyAllPermanently` calls holds the write
    // lock for the whole sweep, and the restore is already non-atomic by
    // construction, so there is nothing to buy by making this half atomic.
    for (const table of tables) {
      await _database.default.write(async () => {
        await collection(table).query().destroyAllPermanently();
      }, `backup-restore-clear-${table}`);
    }
  },
  async createRows(table, rows) {
    const col = collection(table);
    await _database.default.write(async () => {
      const prepared = rows.map(row => col.prepareCreate(record => {
        record._raw = (0, _RawRecord.sanitizedRaw)({
          ...row,
          _status: 'created',
          _changed: ''
        }, col.schema);
      }));
      await _database.default.batch(...prepared);
    }, `backup-restore-write-${table}`);
  },
  async upsertSettings(entries) {
    for (const entry of entries) {
      // A null or undefined value means "this preference was absent on the
      // source device", which is not the same as "set it to the string
      // 'null'" — a settings row's absence IS its default everywhere in this
      // app, so the faithful restore of an absent value is a delete.
      if (entry.value === null || entry.value === undefined) {
        await (0, _settingService.deleteSetting)(entry.key);
      } else {
        await (0, _settingService.setSetting)(entry.key, String(entry.value));
      }
    }
  },
  async finishRestore() {
    await (0, _settingService.deleteSetting)(_types.RESTORE_IN_PROGRESS_KEY);
  },
  async abortRestore() {
    // Deliberately does NOT clear the marker. A restore that failed part way
    // through HAS torn the local data, and the next launch has to be able to
    // tell — clearing it here would hide exactly the state the marker exists
    // to record.
  }
};

/** True when a previous restore never reached `finishRestore`. */
async function restoreWasInterrupted() {
  const rows = await _database.default.get('settings').query(_watermelondb.Q.where('key', _types.RESTORE_IN_PROGRESS_KEY)).fetch();
  return rows.length > 0;
}