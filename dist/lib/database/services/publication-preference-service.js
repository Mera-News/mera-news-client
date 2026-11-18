"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PUBLICATION_PREF_WEIGHT = void 0;
exports.getActive = getActive;
exports.getActiveNamedPublications = getActiveNamedPublications;
exports.getActiveScopes = getActiveScopes;
exports.getAll = getAll;
exports.getPreferenceKind = getPreferenceKind;
exports.getScopePreferenceKind = getScopePreferenceKind;
exports.observeActive = observeActive;
exports.retirePreference = retirePreference;
exports.setPreferenceKind = setPreferenceKind;
exports.setScopePreferenceKind = setScopePreferenceKind;
exports.upsertPreference = upsertPreference;
exports.upsertScopePreference = upsertScopePreference;
exports.weightToPrefKind = weightToPrefKind;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _publicationPrefLevel = require("../../algorithms/publication-pref-level");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Publication-Preference Service — WatermelonDB adapter for persona-v3
// `publication_preferences`. Weights are only ever written explicitly (user /
// feedback-tree / migration) — never auto-derived from visit history.

const prefsCollection = _index.default.get('publication_preferences');

/**
 * source-pref v47. A row is a NAMED-PUBLICATION preference only while it
 * carries no `scope_kind`. Every name-matching site funnels through this so a
 * scope row labelled "India" can never be mistaken for a publication called
 * "India" — the two live in one table precisely so the screen, executor, revert
 * and sweeps don't have to branch on two collections.
 */
function isNamedPublicationRow(p) {
  return p.scopeKind == null;
}

/** Normalized scope token (ISO alpha-3 for `country`). Empty ⇒ null. */
function normalizeScopeValue(s) {
  return s.trim().toUpperCase();
}
/**
 * Creates or updates the preference for a publication (matched by normalized
 * name). Re-activates a retired row on upsert. Returns the record.
 */
async function upsertPreference(input) {
  const clamped = Math.max(-1, Math.min(1, input.weight));
  const all = await prefsCollection.query().fetch();
  const existing = all.find(p => isNamedPublicationRow(p) && (0, _publicationPrefLevel.normalizePrefName)(p.publicationName) === (0, _publicationPrefLevel.normalizePrefName)(input.publicationName));
  return _index.default.write(async () => {
    const now = new Date();
    if (existing) {
      await existing.update(p => {
        p.weight = clamped;
        p.status = 'active';
        if (input.sourceCountryCode !== undefined) p.sourceCountryCode = input.sourceCountryCode ?? null;
        p.updatedAt = now;
      });
      return existing;
    }
    return prefsCollection.create(p => {
      p.publicationName = input.publicationName.trim();
      p.sourceCountryCode = input.sourceCountryCode ?? null;
      p.weight = clamped;
      p.status = 'active';
      p.provenance = input.provenance ?? 'user';
      p.createdAt = now;
      p.updatedAt = now;
    });
  });
}

/** Active preferences only — what the scoring engine consumes. */
async function getActive() {
  return prefsCollection.query(_watermelondb.Q.where('status', 'active')).fetch();
}

/** All preferences (management UI). */
async function getAll() {
  return prefsCollection.query().fetch();
}

/** Reactive query of active preferences. `observeWithColumns`, because a bare
 *  `observe()` emits only when a row joins or leaves, and a hide over a star or
 *  its Undo changes the weight of a row that stays. */
function observeActive() {
  return prefsCollection.query(_watermelondb.Q.where('status', 'active')).observeWithColumns(['weight']);
}

/** Retires a preference (soft delete; history preserved for the audit log). */
async function retirePreference(preferenceId) {
  const record = await prefsCollection.find(preferenceId);
  await _index.default.write(async () => {
    await record.update(p => {
      p.status = 'retired';
      p.updatedAt = new Date();
    });
  });
}

// ---------------------------------------------------------------------------
// Pref-kind surface (feedback tree / persona-action executor)
//
// The feedback tree and agent speak in coarse KINDS ('boost' / 'deprioritize' /
// 'mute') rather than raw weights. These map each kind to a canonical stored
// weight (and back), so a leaf can set/read/revert a publication preference
// without knowing the weight arithmetic.
// ---------------------------------------------------------------------------

/** Canonical weight each pref kind writes. `mute` ≈ block (-1). */
const PUBLICATION_PREF_WEIGHT = exports.PUBLICATION_PREF_WEIGHT = {
  boost: 0.5,
  deprioritize: -0.5,
  mute: -1
};

/** Classify a stored weight back into the pref kind it represents (null ≈ neutral). */
function weightToPrefKind(weight) {
  if (weight <= _publicationPrefLevel.MUTE_WEIGHT) return 'mute';
  if (weight < 0) return 'deprioritize';
  if (weight > 0) return 'boost';
  return null;
}

/** The current pref kind for a publication (matched by normalized name), or 'none'. */
async function getPreferenceKind(publicationName) {
  const all = await prefsCollection.query().fetch();
  const existing = all.find(p => p.status === 'active' && isNamedPublicationRow(p) && (0, _publicationPrefLevel.normalizePrefName)(p.publicationName) === (0, _publicationPrefLevel.normalizePrefName)(publicationName));
  if (!existing) return 'none';
  return weightToPrefKind(existing.weight) ?? 'none';
}

/**
 * Set (or clear) the pref kind for a publication. `'none'` retires any active
 * preference; a concrete kind upserts its canonical weight. Additive wrapper
 * over upsertPreference/retirePreference used by the persona-action executor
 * (apply + revert paths).
 */
async function setPreferenceKind(publicationName, kind, provenance = 'feedback') {
  if (kind === 'none') {
    const all = await prefsCollection.query().fetch();
    const existing = all.find(p => p.status === 'active' && isNamedPublicationRow(p) && (0, _publicationPrefLevel.normalizePrefName)(p.publicationName) === (0, _publicationPrefLevel.normalizePrefName)(publicationName));
    if (existing) await retirePreference(existing.id);
    return;
  }
  await upsertPreference({
    publicationName,
    weight: PUBLICATION_PREF_WEIGHT[kind],
    provenance
  });
}

// ---------------------------------------------------------------------------
// Source SCOPE preferences (source-pref v47)
//
// A scope is a LIVE predicate evaluated against a suggestion's `country_code`
// at render time — NOT an expansion into one row per matching publication. It
// shares this table (and therefore the Source-preferences screen, the executor,
// revertChange and the sweeps) with named-publication rows; `scope_kind` is the
// only thing that tells them apart.
// ---------------------------------------------------------------------------

/** Find the ACTIVE-or-retired row for a scope (matched by kind + normalized value). */
async function findScopeRow(scope, activeOnly) {
  const value = normalizeScopeValue(scope.scopeValue);
  if (value === '') return undefined;
  const all = await prefsCollection.query().fetch();
  return all.find(p => p.scopeKind === scope.scopeKind && normalizeScopeValue(p.scopeValue ?? '') === value && (!activeOnly || p.status === 'active'));
}
/** Creates or updates a source-scope preference. Re-activates a retired row. */
async function upsertScopePreference(input) {
  const clamped = Math.max(-1, Math.min(1, input.weight));
  const value = normalizeScopeValue(input.scopeValue);
  const existing = await findScopeRow(input, false);
  return _index.default.write(async () => {
    const now = new Date();
    if (existing) {
      await existing.update(p => {
        p.publicationName = input.label.trim();
        p.weight = clamped;
        p.status = 'active';
        p.updatedAt = now;
      });
      return existing;
    }
    return prefsCollection.create(p => {
      p.publicationName = input.label.trim();
      p.sourceCountryCode = null;
      p.scopeKind = input.scopeKind;
      p.scopeValue = value;
      p.weight = clamped;
      p.status = 'active';
      p.provenance = input.provenance ?? 'user';
      p.createdAt = now;
      p.updatedAt = now;
    });
  });
}

/** The current pref kind for a source scope, or 'none'. */
async function getScopePreferenceKind(scope) {
  const existing = await findScopeRow(scope, true);
  if (!existing) return 'none';
  return weightToPrefKind(existing.weight) ?? 'none';
}

/**
 * Set (or clear) the pref kind for a source scope. `'none'` retires any active
 * row; a concrete kind upserts its canonical weight. Mirrors
 * `setPreferenceKind` so the executor's apply + revert paths are the same shape
 * for both row kinds.
 *
 * `label` is only consulted when a row is created/updated; on `'none'` it is
 * ignored (the row is retired, keeping its label for the audit trail).
 */
async function setScopePreferenceKind(scope, kind, label, provenance = 'feedback') {
  if (kind === 'none') {
    const existing = await findScopeRow(scope, true);
    if (existing) await retirePreference(existing.id);
    return;
  }
  await upsertScopePreference({
    ...scope,
    label,
    weight: PUBLICATION_PREF_WEIGHT[kind],
    provenance
  });
}

/** Active SCOPE rows only (what the render-time context loader consumes). */
async function getActiveScopes() {
  const active = await getActive();
  return active.filter(p => p.scopeKind != null);
}

/** Active NAMED-PUBLICATION rows only — what `pubPrefs` and the muted-publication
 *  hard-filter derivation must see, so a scope never leaks into either. */
async function getActiveNamedPublications() {
  const active = await getActive();
  return active.filter(isNamedPublicationRow);
}