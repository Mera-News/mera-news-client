"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.deleteSetting = void 0;
exports.getSetting = getSetting;
exports.getSettingsByPrefix = getSettingsByPrefix;
exports.setSetting = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _command = require("../../sync/command");
var _tables = require("../../sync/tables");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const settings = _index.default.get('settings');
async function getSetting(key) {
  const results = await settings.query(_watermelondb.Q.where('key', key)).fetch();
  return results.length > 0 ? results[0].value : null;
}

/**
 * Every setting whose key starts with `prefix`, as a `{ key: value }` map.
 *
 * Exists so a family of per-instance settings (one row per headline scope, say)
 * can be read in ONE query instead of N `getSetting` calls whose key set the
 * caller would first have to know. Callers that need "all overrides" cannot
 * enumerate keys up front — absence is the default, so the rows that exist ARE
 * the answer.
 */
async function getSettingsByPrefix(prefix) {
  const results = await settings.query(_watermelondb.Q.where('key', _watermelondb.Q.like(`${_watermelondb.Q.sanitizeLikeString(prefix)}%`))).fetch();
  const out = {};
  // LIKE only narrows by index: sanitizeLikeString turns every non-alphanumeric
  // character into the one-character wildcard `_`, so the exact prefix is checked here.
  for (const record of results) if (record.key.startsWith(prefix)) out[record.key] = record.value;
  return out;
}
async function setSettingLocal(key, value) {
  // Read-modify-write must happen inside a single write() so the query and the
  // mutation share one transaction. WatermelonDB serializes writes, so this
  // makes the check-then-update atomic — a concurrent deleteSetting() for the
  // same key (common during feed-sync) can no longer tombstone the row between
  // the fetch and the update, which previously threw "Not allowed to change
  // deleted record settings#…".
  await _index.default.write(async () => {
    const existing = await settings.query(_watermelondb.Q.where('key', key)).fetch();
    if (existing.length > 0) {
      try {
        await existing[0].update(record => {
          record.value = value;
        });
      } catch (err) {
        // The fetched record was tombstoned by a concurrent delete (or a
        // migration's direct `DELETE FROM settings`) — WatermelonDB throws
        // "Not allowed to change deleted record settings#…". Self-heal by
        // writing a fresh row instead of surfacing the error. Recoverable, so
        // no Sentry report.
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('deleted record')) throw err;
        await settings.create(record => {
          record.key = key;
          record.value = value;
        });
      }
    } else {
      await settings.create(record => {
        record.key = key;
        record.value = value;
      });
    }
  });
}
async function deleteSettingLocal(key) {
  try {
    await _index.default.write(async () => {
      // Query inside the write() so the fetch + destroy share one transaction —
      // a concurrent writer can't tombstone the row between the two steps.
      const existing = await settings.query(_watermelondb.Q.where('key', key)).fetch();
      if (existing.length === 0) return;
      await existing[0].destroyPermanently();
    });
  } catch (err) {
    // Final safety net: if the row was still concurrently deleted, the goal
    // (row absent) is already achieved — treat as success.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('deleted record')) throw err;
  }
}

// The card state is a mark: it stays local and travels in the batch, so it is not sent as a command.
const sentToPod = key => (0, _tables.isSyncSettingKey)(key) && key !== 'feed_card_state_v1';
const setSetting = exports.setSetting = (0, _command.command)('setSetting', setSettingLocal, {
  when: sentToPod
});
const deleteSetting = exports.deleteSetting = (0, _command.command)('deleteSetting', deleteSettingLocal, {
  when: sentToPod
});