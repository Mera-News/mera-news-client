"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SUPPRESSION_DEFAULT_TTL_MS = exports.HARD_SUPPRESSION_STRENGTH = void 0;
exports.addSuppression = addSuppression;
exports.getActive = getActive;
exports.getAll = getAll;
exports.kindOf = kindOf;
exports.observeActive = observeActive;
exports.reactivateSuppression = reactivateSuppression;
exports.retireSuppression = retireSuppression;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Suppression Service — WatermelonDB adapter for persona-v3
// `persona_suppressions` (negative preferences / show-less escalations).
// strength ≥ 0.8 → hard filter; below that → score penalty. Soft ones decay
// via `expires_at` (default +30d).

const suppressionsCollection = _index.default.get('persona_suppressions');

/** Default soft-suppression lifetime: 30 days. */
const SUPPRESSION_DEFAULT_TTL_MS = exports.SUPPRESSION_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** strength at or above which a suppression is a hard filter (no expiry). */
const HARD_SUPPRESSION_STRENGTH = exports.HARD_SUPPRESSION_STRENGTH = 0.8;
/**
 * Read-side kind resolver. A NULL/absent `kind` column (every pre-v46 row, and
 * every row written by the old keyword-only paths) means 'keyword' — that is
 * what keeps the migration backfill-free.
 */
function kindOf(s) {
  return s.kind ?? 'keyword';
}
async function addSuppression(input) {
  const strength = Math.max(0, Math.min(1, input.strength));
  const defaultExpiry = strength >= HARD_SUPPRESSION_STRENGTH ? null : Date.now() + SUPPRESSION_DEFAULT_TTL_MS;
  return _index.default.write(async () => {
    return suppressionsCollection.create(s => {
      s.pattern = input.pattern.trim();
      s.keywords = input.keywords ?? [];
      s.strength = strength;
      s.source = input.source;
      s.status = 'active';
      s.expiresAt = input.expiresAt !== undefined ? input.expiresAt : defaultExpiry;
      s.createdAt = new Date();
      // Left NULL when omitted — NULL kind reads as 'keyword' (kindOf).
      s.kind = input.kind ?? null;
      s.value = input.value ?? null;
    });
  });
}

/** Active, non-expired suppressions — what the scoring engine consumes. */
async function getActive(now = Date.now()) {
  const rows = await suppressionsCollection.query(_watermelondb.Q.where('status', 'active')).fetch();
  return rows.filter(s => s.expiresAt == null || s.expiresAt > now);
}

/** All suppressions (management UI / audit). */
async function getAll() {
  return suppressionsCollection.query(_watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc)).fetch();
}

/** Reactive query of active rows (expiry filtering is the consumer's job). */
function observeActive() {
  return suppressionsCollection.query(_watermelondb.Q.where('status', 'active')).observe();
}
async function retireSuppression(suppressionId) {
  const record = await suppressionsCollection.find(suppressionId);
  await _index.default.write(async () => {
    await record.update(s => {
      s.status = 'retired';
    });
  });
}

/**
 * Undo a retire: flip `status` back to 'active', keeping the ORIGINAL
 * `expires_at` untouched.
 *
 * Consequence, deliberate: a SOFT row whose original expiry has already passed
 * comes back inert — `getActive()` filters it out again on the next read, so
 * reactivating a long-dead soft suppression is a no-op rather than a silent
 * 30-day extension. Hard rows (strength ≥ HARD_SUPPRESSION_STRENGTH) carry a
 * null expiry, so reactivating one always takes effect.
 */
async function reactivateSuppression(suppressionId) {
  const record = await suppressionsCollection.find(suppressionId);
  await _index.default.write(async () => {
    await record.update(s => {
      s.status = 'active';
    });
  });
}