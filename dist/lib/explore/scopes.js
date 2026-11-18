"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.alpha2ToAlpha3 = alpha2ToAlpha3;
exports.deriveExploreScopes = deriveExploreScopes;
exports.electPrimaryCountry = electPrimaryCountry;
var _i18nIsoCountries = _interopRequireDefault(require("i18n-iso-countries"));
var _countryUtils = require("../algorithms/country-utils");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Explore tab — scope derivation.
//
// Turns the user's on-device `locations` (never sent to the server) plus the
// device-locale country into the horizontal scope chips shown on the Explore
// tab. Each scope drives a DIRECT server-paginated article query — there is no
// scoring, no LLM, and nothing persisted (see components/custom/explore).
//
// Chips are COUNTRY… + World (2026-07-27). The Top
// stories chip and its blended GLOBAL+home feed were deleted outright —
// trending headlines mostly don't concern the user, so the tab no longer
// leads with them.
//
// Order is `[World, primary country?, ...remaining countries weight-desc]`:
// World is ALWAYS present and ALWAYS FIRST, and no country is ever dropped.
// The primary country is elected by
// {@link electPrimaryCountry} (highest-weight `role: 'home'` row, else
// highest-weight row overall, else the device country) and de-duped out of
// the tail so it never appears twice. Cold-mount lands on the first chip,
// which is now World.
//
// City/region derivation was removed because geo-tags
// are dormant in prod (all null), so those chips showed ~nothing. Each
// location still contributes its country. The `'city'|'region'` scope-kind
// members survive only while an Explore test still names them; nothing builds such a scope.
//
// Country-code formats (subtle — three different conventions collide here):
//   • WatermelonDB `locations.countryCode` and `NewsArticle.geo_tags.countryCode`
//     are ISO alpha-2 (the server normalizes geo tags via CountryCodeMapper).
//   • `articlesForCountry(countryCode:)` filters on the publication's
//     `country_code`, which is ISO alpha-3.
// So a scope carries BOTH: alpha-2 (for the on-device geo-tag filter) and
// alpha-3 (the fetch argument). World fetches with the 'GLOBAL' sentinel.

/**
 * Role tags a `locations` row can carry. Deliberately a LOCAL string union
 * rather than an import of `LocationRole` from lib/database/models/Location.ts
 * — that file imports `@nozbe/watermelondb`, and this module is decoupled from
 * the model (see {@link ScopeLocationInput}) so it stays pure and testable.
 * Structurally identical to `LocationRole`, so model rows assign directly.
 */

/** Minimal shape the derivation needs (decoupled from the WatermelonDB model). */

/** ISO alpha-2 → alpha-3, or null when unmappable. */
function alpha2ToAlpha3(alpha2) {
  const a2 = (alpha2 ?? '').trim().toUpperCase();
  if (!a2) return null;
  return _i18nIsoCountries.default.alpha2ToAlpha3(a2) ?? null;
}
function worldScope() {
  return {
    id: 'world',
    kind: 'world',
    label: '',
    icon: 'public',
    countryCodeAlpha3: null
  };
}
function countryScope(alpha2, alpha3) {
  return {
    id: `country:${alpha3}`,
    kind: 'country',
    label: (0, _countryUtils.getCountryName)(alpha3),
    icon: 'flag',
    flagEmoji: (0, _countryUtils.getFlagEmoji)(alpha3),
    countryCodeAlpha3: alpha3,
    countryCodeAlpha2: alpha2
  };
}

/**
 * Elect the user's primary country — the first COUNTRY chip (World now leads
 * the row, so this is the second chip overall).
 *
 * Rule, in order:
 *   1. The highest-weight `role: 'home'` location with a mappable country.
 *   2. Failing that, the highest-weight location with a mappable country.
 *   3. Failing that, the device-locale country.
 *   4. Failing that, null.
 *
 * `locations` arrives pre-sorted weight-desc (the `location-service` query
 * sorts on `weight`), so "highest-weight" is just "first match".
 *
 * This is the same precedence `loadUserGeoLanguageContext` applies, so the
 * Explore landing chip and the retrieval profile agree on which country is
 * "the user's". Note step 3 is effectively the last stop in the app:
 * `getDeviceCountryAlpha2()` hard-falls-back to 'US' and never returns null,
 * so only a caller passing an explicit null/unmappable code reaches step 4.
 */
function electPrimaryCountry(locations, deviceCountryAlpha2) {
  const toScope = loc => {
    const alpha3 = alpha2ToAlpha3(loc.countryCode);
    if (!alpha3) return null;
    return countryScope(loc.countryCode.trim().toUpperCase(), alpha3);
  };
  for (const loc of locations) {
    if (loc.role !== 'home') continue;
    const scope = toScope(loc);
    if (scope) return scope;
  }
  for (const loc of locations) {
    const scope = toScope(loc);
    if (scope) return scope;
  }
  const deviceAlpha3 = alpha2ToAlpha3(deviceCountryAlpha2);
  if (deviceAlpha3) {
    return countryScope((deviceCountryAlpha2 ?? '').trim().toUpperCase(), deviceAlpha3);
  }
  return null;
}

/**
 * Build the Explore scope chips.
 *
 * Order:
 *   1. World — always present, always FIRST.
 *   2. The primary country (see {@link electPrimaryCountry}). Omitted only
 *      when neither the locations nor the device country resolve.
 *   3. The remaining location-derived country scopes (weight-desc, the
 *      primary excluded so it never appears twice). City/region scopes are no
 *      longer derived — see the module header.
 *   4. `browseCountries` (alpha-2, from lib/explore/browse-countries.ts) —
 *      countries the user added via Sources' "+", in array order. Appended
 *      LAST and deduped against everything above, so a country already
 *      reachable via a location never appears twice. This is display-only:
 *      browse countries carry no location/weight and never affect
 *      {@link electPrimaryCountry} — a browse country can never become the
 *      primary chip.
 *
 * De-duped by scope id. There is NO cap (owner): a capped list cut browse
 * countries first, so Sources showed a country as added while Explore had no
 * chip for it. The row scrolls, and a scope only fetches when selected.
 */
function deriveExploreScopes(locations, deviceCountryAlpha2, browseCountries = []) {
  const primary = electPrimaryCountry(locations, deviceCountryAlpha2);
  const countryScopes = [];
  const seenAlpha3 = new Set();
  if (primary) {
    seenAlpha3.add(primary.countryCodeAlpha3);
    countryScopes.push(primary);
  }
  for (const loc of locations) {
    const alpha3 = alpha2ToAlpha3(loc.countryCode);
    if (!alpha3 || seenAlpha3.has(alpha3)) continue;
    seenAlpha3.add(alpha3);
    countryScopes.push(countryScope(loc.countryCode.trim().toUpperCase(), alpha3));
  }
  for (const alpha2 of browseCountries) {
    const alpha3 = alpha2ToAlpha3(alpha2);
    if (!alpha3 || seenAlpha3.has(alpha3)) continue;
    seenAlpha3.add(alpha3);
    countryScopes.push(countryScope((alpha2 ?? '').trim().toUpperCase(), alpha3));
  }
  return [worldScope(), ...countryScopes];
}