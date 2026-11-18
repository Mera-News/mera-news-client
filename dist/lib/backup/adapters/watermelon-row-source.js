"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.watermelonRowSource = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _database = _interopRequireDefault(require("../../database"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The `RowSource` port over WatermelonDB.
//
// `unsafeFetchRaw()` returns the raw column objects rather than hydrated Model
// instances, which is what the exporter wants: it is about to JSON-serialise
// them, and hydrating 70k models to read their fields back out would be pure
// cost. "Unsafe" here means "you get untyped raws", not "this bypasses the
// database".
//
// Importing `@/lib/database` CONSTRUCTS the SQLite adapter at module evaluation
// (`lib/database/index.ts:32`), so this file is native-coupled and the backup
// core never imports it.

function collection(table) {
  return _database.default.get(table);
}
const watermelonRowSource = exports.watermelonRowSource = {
  /**
   * `database.read()` guarantees no Writer runs for the duration, which is what
   * makes the whole export one consistent snapshot. Reads from other callers
   * still proceed; only writes queue behind it.
   */
  snapshot(work) {
    return _database.default.read(() => work(), 'backup-export-snapshot');
  },
  async page(query) {
    const clauses = [...query.orderBy.map(o => _watermelondb.Q.sortBy(o.column, o.desc ? _watermelondb.Q.desc : _watermelondb.Q.asc)), _watermelondb.Q.skip(query.offset), _watermelondb.Q.take(query.limit)];
    const raws = await collection(query.table).query(...clauses).unsafeFetchRaw();
    return raws;
  },
  count(table) {
    return collection(table).query().fetchCount();
  }
};