"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addSuppressedScopeId = addSuppressedScopeId;
exports.getSuppressedScopeIds = getSuppressedScopeIds;
exports.removeSuppressedScopeId = removeSuppressedScopeId;
var _settingService = require("../database/services/setting-service");
// Hidden World country pages. Removing a PLACE-DERIVED country in the World
// arrange overlay must hide its page without deleting the underlying location
// (and therefore without touching its geo-scoring signal). A browse-added
// country (lib/explore/browse-countries.ts) has no such signal to protect, so
// removing one of those deletes it from the browse set and never touches this
// set. `removeWorldCountry` (lib/explore/world-pages.ts) decides which.
//
// Storage: a second setting-service KV row, JSON array of scope ids
// (e.g. `country:IND`), NOT alpha-2 page ids: `deriveWorldPages` filters the
// derived `ExploreScope[]` by scope id and converts to page ids after. Only
// `country:` ids are kept, on every read and write: `world` can never be
// hidden, and the old `city:`/`region:` entries (those scopes no longer exist)
// drop out on read, including when an old backup brings them back. No
// migration, no flag.

const SUPPRESSED_SCOPES_KEY = 'explore_suppressed_scopes';
const COUNTRY_PREFIX = 'country:';
function normalize(id) {
  return (id ?? '').trim();
}
function dedupe(ids) {
  const seen = new Set();
  const out = [];
  for (const raw of ids) {
    const id = normalize(raw);
    if (!id.startsWith(COUNTRY_PREFIX) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The user's suppressed (hidden) scope ids. Malformed or missing storage
 * (garbage JSON, non-array, non-string members) resolves to `[]`. Only
 * `country:` ids come back, whatever the row holds.
 */
async function getSuppressedScopeIds() {
  const raw = await (0, _settingService.getSetting)(SUPPRESSED_SCOPES_KEY);
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return dedupe(parsed.filter(x => typeof x === 'string'));
}

/** Hide a country scope id. No-op for anything else. Idempotent. Returns the resulting set. */
async function addSuppressedScopeId(id) {
  const current = await getSuppressedScopeIds();
  const next = dedupe([...current, id]);
  await (0, _settingService.setSetting)(SUPPRESSED_SCOPES_KEY, JSON.stringify(next));
  return next;
}

/** Un-hide a scope id. Idempotent. Returns the resulting set. */
async function removeSuppressedScopeId(id) {
  const current = await getSuppressedScopeIds();
  const target = normalize(id);
  const next = current.filter(c => c !== target);
  await (0, _settingService.setSetting)(SUPPRESSED_SCOPES_KEY, JSON.stringify(next));
  return next;
}