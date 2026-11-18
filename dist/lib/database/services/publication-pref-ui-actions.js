"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.cancelPendingPurges = cancelPendingPurges;
exports.commitSourcePrefPurge = void 0;
exports.getPublisherPrefLevel = getPublisherPrefLevel;
exports.setSourcePrefFromUi = exports.revertSourcePrefChange = void 0;
var _personaActionExecutor = require("./persona-action-executor");
var publicationPreferenceService = _interopRequireWildcard(require("./publication-preference-service"));
var changeLogService = _interopRequireWildcard(require("./persona-change-log-service"));
var _personaMutationSweeps = require("./persona-mutation-sweeps");
var _actionNames = require("../../news-harness/persona-management/action-names");
var _scopes = require("../../explore/scopes");
var _publicationPrefLevel = require("../../algorithms/publication-pref-level");
var _command = require("../../sync/command");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
// Source-preference UI actions. The ONE entry point every
// More/Fewer control in the app calls — the publication page, the Sources
// screen's rows and search, and "Fewer from" in an article's menu.
//
// The friction this removes: before this module, `PublicationPreferencesScreen`
// carried its own hand-rolled apply/clear logic (see git history) and every new
// ↑/↓ surface would have had to re-derive the same 5-step dance (guard → read
// `before` → apply → change-log → sweep) or drift from it. Now there is exactly
// one place that knows how to write a boost/downrank/none, for either a named
// publication or a country scope, and every caller — including
// `PublicationPreferencesScreen` itself — routes through it.
//
// `muted` is Not preferred, a hard exclusion. The row is written at once and the
// live filters hide the publication from the Feed, but the purge waits for the
// toast's Undo window: an excluded row loses its score and an undo sends it back
// through scoring. The caller runs `commitPurge()` when the toast closes. If the
// app dies first nothing is lost: every purge reads the live filters, so the next
// one (each gate propagation, each filter change) takes these rows too.
//
// Boost and downrank writes route through
// `applyPersonaAction` — never a bare `setPreferenceKind`/`setScopePreferenceKind`
// — because the executor already owns the change-log row (Activity undo) and
// the sweep decision. Nothing further is needed here for those two levels.
//
// `'none'` (clear) has no executor action — `SET_PUBLICATION_PREF` /
// `SET_SOURCE_SCOPE_PREF` both require a concrete `publicationPref` — so this
// module hand-appends the change-log row itself, exactly mirroring what the
// executor does for every other mutation. This mirrors
// `PublicationPreferencesScreen`'s pre-existing clear logic, which is why that
// screen's `handleClear`/`handleSetKind` now delegate here instead of
// duplicating it.

// Import-only: this module does not own lib/explore/**. Pure/RN-free (see its
// own header), so pulling it in here adds no native/DB coupling.

/**
 * `'none'` clears whatever is currently set (a no-op write if nothing was
 * set). A country can never be `'muted'`. Defined in the pure
 * `publication-pref-level` module so list rows can read it without the DB.
 */

/**
 * What the control is acting on.
 *
 *  - `publication`: matched by `publication_name` (source-pref's existing
 *    name-matching contract — no `source_id`).
 *  - `country`: a LIVE scope predicate ("prefer/deprioritise sources from
 *    India"), not an expansion into one row per matching publication.
 *    `countryAlpha2` is deliberately alpha-2 — the convention "Explore/sources"
 *    UI code speaks (see lib/explore/scopes.ts) — because that is the format
 *    every caller of this module already has on hand for a country row.
 *    `PublicationPreference.scopeValue` is ISO ALPHA-3; the conversion happens
 *    once, right here at the boundary, so alpha-2 never reaches the store and
 *    alpha-3 never leaks back out to a caller expecting alpha-2. A caller that
 *    already holds the canonical alpha-3 (e.g. a stored `PublicationPreference`
 *    row) must convert to alpha-2 with `alpha3ToAlpha2` before calling in —
 *    two conventions must never meet inside the store.
 */

const LEVEL_TO_PREF_KIND = {
  prioritised: 'boost',
  muted: 'mute'
};

/** Boost/downrank a named publication — routes through the executor, which owns everything else. */
async function setNamedPublicationLevel(publicationName, kind) {
  const result = await (0, _personaActionExecutor.applyPersonaAction)({
    action_type: _actionNames.ACTION_NAMES.SET_PUBLICATION_PREF,
    publicationId: publicationName,
    publicationPref: kind
  }, 'user');
  return {
    applied: result.applied,
    changeLogId: result.changeLogId
  };
}

/** The executor's mute, minus its sweep: see the header. One name of an action. */
async function muteNamedPublication(publicationName) {
  const before = await publicationPreferenceService.getPreferenceKind(publicationName);
  await publicationPreferenceService.setPreferenceKind(publicationName, 'mute', 'user');
  const row = await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.SET_PUBLICATION_PREF,
    action: {
      targetId: publicationName,
      before,
      after: 'mute'
    },
    source: 'user',
    summary: `Set publication preference: ${publicationName} → mute`
  });
  return {
    applied: true,
    changeLogId: row.id
  };
}

// A purge that ran before an undo would have destroyed the muted rows, so each waits here for its
// toast to close. The timer runs it if nothing does, as when a phone is killed mid-toast.
const PURGE_SAFETY_MS = 60_000;
const pendingPurges = new Map();
async function commitSourcePrefPurgeLocal(changeLogId) {
  const pending = pendingPurges.get(changeLogId);
  if (!pending) return;
  pendingPurges.delete(changeLogId);
  clearTimeout(pending.timer);
  await pending.run();
}

/** Drops every waiting purge and its timer. A reset calls it, so a purge belonging to the person who
 *  logged out never runs in the next account's database, and no timer outlives its owner. */
function cancelPendingPurges() {
  for (const {
    timer
  } of pendingPurges.values()) clearTimeout(timer);
  pendingPurges.clear();
}

/** Runs the purge a mute left waiting, once. An id with nothing waiting does nothing. */
const commitSourcePrefPurge = exports.commitSourcePrefPurge = (0, _command.command)('commitSourcePrefPurge', commitSourcePrefPurgeLocal);
function holdPurge(changeLogId) {
  const timer = setTimeout(() => void commitSourcePrefPurgeLocal(changeLogId), PURGE_SAFETY_MS);
  timer.unref?.();
  pendingPurges.set(changeLogId, {
    run: purgeOnce(),
    timer
  });
  return () => commitSourcePrefPurgeLocal(changeLogId);
}

/** One purge per action, however many names it wrote. */
function purgeOnce() {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await (0, _personaMutationSweeps.runSweepFor)('purge', _actionNames.ACTION_NAMES.SET_PUBLICATION_PREF);
  };
}

/** Boost/downrank a country scope — routes through the executor, which owns everything else. */
async function setCountryScopeLevel(countryAlpha2, label, kind) {
  const alpha3 = (0, _scopes.alpha2ToAlpha3)(countryAlpha2);
  if (!alpha3) return {
    applied: false
  };
  const result = await (0, _personaActionExecutor.applyPersonaAction)({
    action_type: _actionNames.ACTION_NAMES.SET_SOURCE_SCOPE_PREF,
    scopeKind: 'country',
    scopeValue: alpha3,
    scopeLabel: label,
    publicationPref: kind
  }, 'user');
  return {
    applied: result.applied,
    changeLogId: result.changeLogId
  };
}

/**
 * Clear a named-publication preference. No executor 'none' action exists, so
 * this hand-appends the change-log row and runs the same sweep policy the
 * executor would have (a mute IS a hard filter — un-muting/clearing must give
 * its casualties a second chance; every other before-state is a no-op sweep).
 */
async function clearNamedPublicationLevel(publicationName) {
  const before = await publicationPreferenceService.getPreferenceKind(publicationName);
  await publicationPreferenceService.setPreferenceKind(publicationName, 'none', 'user');
  const row = await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.SET_PUBLICATION_PREF,
    action: {
      targetId: publicationName,
      before,
      after: 'none'
    },
    source: 'user',
    summary: `Cleared publication preference: ${publicationName}`
  });
  await (0, _personaMutationSweeps.runSweepFor)((0, _personaMutationSweeps.sweepForMutation)({
    actionType: _actionNames.ACTION_NAMES.SET_PUBLICATION_PREF,
    prefBefore: before,
    prefAfter: 'none'
  }), _actionNames.ACTION_NAMES.SET_PUBLICATION_PREF);
  return {
    applied: true,
    changeLogId: row?.id
  };
}

/**
 * Clear a country-scope preference. A scope can never be muted (the executor
 * rejects it, stage-scoring never derives a hard filter from one), so there is
 * nothing to retroactively sweep — unlike the named-publication clear above,
 * this never calls `sweepForMutation`/`runSweepFor`; the next scoring pass
 * picks the change up. Mirrors `PublicationPreferencesScreen`'s pre-existing scope
 * clear exactly.
 */
async function clearCountryScopeLevel(countryAlpha2, label) {
  const alpha3 = (0, _scopes.alpha2ToAlpha3)(countryAlpha2);
  if (!alpha3) return {
    applied: false
  };
  const scope = {
    scopeKind: 'country',
    scopeValue: alpha3
  };
  const before = await publicationPreferenceService.getScopePreferenceKind(scope);
  await publicationPreferenceService.setScopePreferenceKind(scope, 'none', label, 'user');
  const row = await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.SET_SOURCE_SCOPE_PREF,
    action: {
      targetId: `country:${alpha3}`,
      before,
      after: 'none'
    },
    source: 'user',
    summary: `Cleared source-scope preference: ${label}`
  });
  return {
    applied: true,
    changeLogId: row.id
  };
}

/**
 * Set or clear one publication across all its names. Only names whose level
 * differs are written, so pressing the level already shown logs nothing, and
 * an undo reverts exactly what this press changed.
 */
async function setPublisherLevel(rawNames, level) {
  const names = (0, _publicationPrefLevel.publisherPrefNames)(rawNames);
  if (names.length === 0) return {
    applied: false
  };
  const ids = [];
  let muted = false;
  for (const name of names) {
    const kind = await publicationPreferenceService.getPreferenceKind(name);
    if (kind === (level === 'none' ? 'none' : LEVEL_TO_PREF_KIND[level])) continue;
    let res;
    if (level === 'none') res = await clearNamedPublicationLevel(name);else if (level === 'muted') {
      res = await muteNamedPublication(name);
      muted = true;
    } else res = await setNamedPublicationLevel(name, LEVEL_TO_PREF_KIND[level]);
    if (res.changeLogId) ids.push(res.changeLogId);
    // A refused write stops the run; what was written stays undoable.
    if (!res.applied) return {
      applied: false,
      changeLogId: ids[0],
      changeLogIds: ids
    };
  }
  // Nothing differed: the state already is `level`, which is a success.
  return {
    applied: true,
    changeLogId: ids[0],
    changeLogIds: ids,
    ...(muted ? {
      commitPurge: holdPurge(ids[0]),
      purgePending: true
    } : {})
  };
}

/**
 * The current level of one publication across all its names (a mute wins over
 * a preference). The async twin of `resolvePrefLevel`, for a caller without an
 * observed row set.
 */
async function getPublisherPrefLevel(names) {
  if (names.length === 0) return 'none';
  const rows = await publicationPreferenceService.getActiveNamedPublications();
  return (0, _publicationPrefLevel.resolvePrefLevel)(rows, names);
}

/**
 * Undo a `setSourcePrefFromUi` result: reverts every change-log row it wrote,
 * newest first, each compare-and-set (a newer change to that name wins and
 * is left alone). True when at least one row was reverted.
 */
async function revertSourcePrefChangeLocal(result) {
  const ids = result.changeLogIds ?? (result.changeLogId ? [result.changeLogId] : []);
  let reverted = false;
  for (const id of [...ids].reverse()) {
    if (await changeLogService.revertChange(id)) reverted = true;
  }
  return reverted;
}
const revertSourcePrefChange = exports.revertSourcePrefChange = (0, _command.command)('revertSourcePrefChange', revertSourcePrefChangeLocal);

/**
 * Set (or clear) the source-preference level for a publication or a country
 * scope, from any ↑/↓ control in the app. The single entry point the design
 * requires — never call `setPreferenceKind`/`setScopePreferenceKind` directly
 * from UI code.
 */
async function setSourcePrefFromUiLocal(target, level) {
  if (target.kind === 'publisher') return setPublisherLevel(target.names, level);
  if (level === 'muted') {
    return target.kind === 'publication' ? setPublisherLevel([target.publicationName], level) : {
      applied: false
    };
  }
  if (level === 'none') {
    return target.kind === 'publication' ? clearNamedPublicationLevel(target.publicationName) : clearCountryScopeLevel(target.countryAlpha2, target.label);
  }
  const kind = LEVEL_TO_PREF_KIND[level];
  return target.kind === 'publication' ? setNamedPublicationLevel(target.publicationName, kind) : setCountryScopeLevel(target.countryAlpha2, target.label, kind);
}
const setSourcePrefFromUi = exports.setSourcePrefFromUi = (0, _command.command)('setSourcePrefFromUi', setSourcePrefFromUiLocal, {
  // A function cannot cross the wire, so the toast's close is sent as its own command.
  onResult: result => result.purgePending && result.changeLogId ? {
    ...result,
    commitPurge: () => commitSourcePrefPurge(result.changeLogId)
  } : result
});