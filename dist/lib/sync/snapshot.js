"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildSnapshot = buildSnapshot;
var _sha = require("@noble/hashes/sha2.js");
var _utils = require("@noble/hashes/utils.js");
var _watermelonRowSource = require("../backup/adapters/watermelon-row-source");
var _export = require("../backup/export");
var _schema = _interopRequireDefault(require("../database/schema"));
var _tables = require("./tables");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const PAGE_ROWS = 500;
// `_status` and `_changed` are local bookkeeping, the same two columns a backup drops.
function toRow(raw) {
  const {
    _status: _s,
    _changed: _c,
    $loki: _l,
    ...rest
  } = raw;
  return rest;
}
async function readAll(table) {
  const out = [];
  for (let offset = 0;; offset += PAGE_ROWS) {
    const page = await _watermelonRowSource.watermelonRowSource.page({
      table,
      orderBy: (0, _export.orderForTable)(table),
      limit: PAGE_ROWS,
      offset
    });
    out.push(...page.map(toRow));
    if (page.length < PAGE_ROWS) return out;
  }
}
async function buildSnapshot(options) {
  const local = {
    schemaVersion: _schema.default.version,
    registry: options.registry
  };
  if (options.peer) (0, _tables.assertSameVersions)(local, options.peer, 'server');
  const tables = {};
  // One reader for every table, so no child row is served without its parent.
  await _watermelonRowSource.watermelonRowSource.snapshot(async () => {
    for (const {
      name,
      mode
    } of _tables.SYNC_TABLES) {
      let rows = await readAll(name);
      if (name === 'settings') {
        rows = rows.filter(r => (0, _tables.isSyncSettingKey)(String(r.key))).map(r => ({
          key: r.key,
          value: r.value
        })).sort((a, b) => String(a.key).localeCompare(String(b.key)));
      }
      const hash = (0, _utils.bytesToHex)((0, _sha.sha256)(new TextEncoder().encode(rows.map(r => JSON.stringify(r)).join('\n'))));
      tables[name] = hash === options.hashes[name] ? {
        hash,
        mode
      } : {
        hash,
        mode,
        rows
      };
    }
  });
  return {
    ...local,
    tables
  };
}