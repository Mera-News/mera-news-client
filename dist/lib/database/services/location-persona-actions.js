"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addUserLocation = addUserLocation;
exports.deleteUserLocation = deleteUserLocation;
exports.setLocationWeightLogged = setLocationWeightLogged;
var locationService = _interopRequireWildcard(require("./location-service"));
var _normalizeKey = require("../../algorithms/normalize-key");
var _personaActionExecutor = require("./persona-action-executor");
var changeLogService = _interopRequireWildcard(require("./persona-change-log-service"));
var _actionNames = require("../../news-harness/persona-management/action-names");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
// Location persona actions — the change-logged surface the
// locations screen uses for add / delete / weight edits.
//
// `location-service` is the raw WatermelonDB adapter (no change-log). This file
// composes it with the persona change-log so every user-driven location change
// is auditable:
//   • weight edits  → `applyPersonaAction(set_location_weight, 'slider')`
//     (INVERTIBLE — reads `before` internally, revert restores it)
//   • add           → `upsertLocation` + an `add_location` audit row
//     (NOT invertible yet)
//   • delete        → `deleteLocation` + a `delete_location` audit row
//     (NOT invertible — destroyPermanently, nothing to restore)

/** Human label for change-log summaries (English only — summaries are stored raw). */
function labelFor(city, countryCode) {
  const c = (city ?? '').trim();
  return c ? `${c}, ${countryCode.toUpperCase()}` : countryCode.toUpperCase();
}
/**
 * Add (or dedupe-update) a user location, change-logged. Dedupe mirrors
 * `upsertLocation` (normalized city + country_code + role). On a match the row's
 * weight is changed through the invertible `set_location_weight` action; on a
 * fresh insert an `add_location` audit row is appended.
 */
async function addUserLocation(input) {
  const all = await locationService.getAll();
  const existing = all.find(l => l.countryCode === input.countryCode && (0, _normalizeKey.normalizeKeyOrEmpty)(l.city) === (0, _normalizeKey.normalizeKeyOrEmpty)(input.city) && l.role === input.role);
  if (existing) {
    // Route the weight change through the invertible action so the dedupe path
    // is auditable too. Region refresh (if any) goes through upsert separately.
    if (typeof input.weight === 'number' && input.weight !== existing.weight) {
      await (0, _personaActionExecutor.applyPersonaAction)({
        action_type: _actionNames.ACTION_NAMES.SET_LOCATION_WEIGHT,
        locationId: existing.id,
        weight: input.weight
      }, 'slider');
    }
    // A hand-add over a derived row makes the place the reader's: dropping the
    // link keeps it through Clear profile.
    const location = await locationService.upsertLocation({
      ...input,
      weight: undefined,
      sourceFactId: input.sourceFactId ?? null
    });
    return {
      location,
      updated: true
    };
  }
  const location = await locationService.upsertLocation({
    ...input,
    provenance: 'user'
  });
  await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.ADD_LOCATION,
    action: {
      targetId: location.id,
      city: input.city ?? null,
      countryCode: input.countryCode,
      role: input.role
    },
    source: 'user',
    summary: `Added location: ${labelFor(input.city, input.countryCode)}`
  });
  return {
    location,
    updated: false
  };
}

/** Delete a user location, appending an audit-only (non-invertible) change-log row. */
async function deleteUserLocation(location) {
  await locationService.deleteLocation(location.id);
  await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.DELETE_LOCATION,
    action: {
      targetId: location.id,
      city: location.city,
      countryCode: location.countryCode,
      role: location.role
    },
    source: 'user',
    summary: `Removed location: ${labelFor(location.city, location.countryCode)}`
  });
}

/** Change a location's weight through the invertible `set_location_weight` action. */
async function setLocationWeightLogged(locationId, weight) {
  await (0, _personaActionExecutor.applyPersonaAction)({
    action_type: _actionNames.ACTION_NAMES.SET_LOCATION_WEIGHT,
    locationId,
    weight
  }, 'slider');
}