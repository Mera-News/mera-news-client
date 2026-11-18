"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.countSummaryStrings = countSummaryStrings;
exports.deleteSummaryString = deleteSummaryString;
exports.getAllSummaryStrings = getAllSummaryStrings;
exports.getLatestPersonaVersion = getLatestPersonaVersion;
exports.observeSummaryStrings = observeSummaryStrings;
exports.replaceAllSummaryStrings = replaceAllSummaryStrings;
exports.toRow = toRow;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Persona-Summary Service — WatermelonDB adapter for `persona_summary_strings`.
//
// Long-lived, user-owned "About you" strings (schema v38). The generation
// pipeline (lib/inference/handlers/persona-summary-handler.ts) writes them via
// `replaceAllSummaryStrings`; the Profile tab reads/observes them and the
// per-string sheet deletes one via `deleteSummaryString`. English-canonical —
// rendered through TranslatableDynamic.

const collection = _index.default.get('persona_summary_strings');

/** Plain read-model row for the UI (JSON columns parsed). */

function parseIds(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function toRow(m) {
  return {
    id: m.id,
    text: m.text,
    linkedFactIds: parseIds(m.linkedFactIdsJson),
    linkedTopicIds: parseIds(m.linkedTopicIdsJson),
    generatedAt: m.generatedAt.getTime(),
    personaVersion: m.personaVersion ?? null,
    stale: m.stale ?? false
  };
}

/** All strings, oldest-first (matches `observeSummaryStrings` order). */
async function getAllSummaryStrings() {
  const rows = await collection.query(_watermelondb.Q.sortBy('generated_at', _watermelondb.Q.asc)).fetch();
  return rows.map(toRow);
}

/** Live query for the Profile screen — emits on every replaceAll/delete. */
function observeSummaryStrings() {
  return collection.query(_watermelondb.Q.sortBy('generated_at', _watermelondb.Q.asc)).observe();
}
async function countSummaryStrings() {
  return collection.query().fetchCount();
}

/** The persona fingerprint the current strings were generated for (null when
 *  there are none). Used by the regeneration trigger to skip no-op runs. */
async function getLatestPersonaVersion() {
  const rows = await collection.query(_watermelondb.Q.sortBy('generated_at', _watermelondb.Q.desc), _watermelondb.Q.take(1)).fetch();
  return rows[0]?.personaVersion ?? null;
}

/**
 * Atomically replace ALL strings with a freshly generated set, stamping the
 * persona fingerprint they were built from. Old strings render until this
 * commits — there is no intermediate empty state.
 */
async function replaceAllSummaryStrings(results, personaVersion) {
  await _index.default.write(async () => {
    const existing = await collection.query().fetch();
    const now = new Date();
    const deletes = existing.map(r => r.prepareDestroyPermanently());
    const creates = results.map(res => collection.prepareCreate(m => {
      m.text = res.text;
      m.linkedFactIdsJson = JSON.stringify(res.linkedFactIds);
      m.linkedTopicIdsJson = JSON.stringify(res.linkedTopicIds);
      m.generatedAt = now;
      m.personaVersion = personaVersion;
      m.stale = false;
    }));
    await _index.default.batch([...deletes, ...creates]);
  });
}

/**
 * Delete one string (its linked facts/topics are removed separately by the
 * caller) and mark the rest stale so the next focus regenerates a clean set.
 */
async function deleteSummaryString(id) {
  try {
    const record = await collection.find(id);
    await _index.default.write(async () => {
      const others = await collection.query(_watermelondb.Q.where('id', _watermelondb.Q.notEq(id)), _watermelondb.Q.where('stale', _watermelondb.Q.notEq(true))).fetch();
      const batch = [record.prepareDestroyPermanently(), ...others.map(r => r.prepareUpdate(m => {
        m.stale = true;
      }))];
      await _index.default.batch(batch);
    });
  } catch (err) {
    _logger.default.warn('[persona-summary] deleteSummaryString failed', {
      id,
      error: String(err)
    });
  }
}