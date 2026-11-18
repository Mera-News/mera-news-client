"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.baseLang = baseLang;
exports.countryRank = countryRank;
exports.normAlpha3 = normAlpha3;
exports.normPublicationName = normPublicationName;
exports.repPriorityTier = repPriorityTier;
exports.sourcePriorityTier = sourcePriorityTier;
/**
 * Shared geo/language priority helpers for the For-You feed.
 *
 * Pure functions only — NO imports from React Native, WatermelonDB, Zustand
 * stores, or the logger. This module is unit-tested in isolation and is safe to
 * import from any layer (feed sync, scoring pipeline, screen memos). The
 * RN-coupled loader that BUILDS a `UserGeoLanguageContext` from on-device
 * `locations` + the app-language store lives in
 * `lib/user-context/user-geo-language-context.ts`; this file only consumes one.
 *
 * The problem it solves: representative election (which sibling of a
 * duplicate-story group gets scored / fronts a card) and the merged
 * "Related Articles" list were country/language-blind. The user wants a
 * priority order anchored to their own signals: an article from the user's
 * HOME country outranks one from another of the user's countries, which
 * outranks one merely in the user's app-UI language, which outranks the rest.
 *
 * Country-code format (subtle): article/publication `country_code` is ISO
 * ALPHA-3, and so are the codes carried in `UserGeoLanguageContext` (the loader
 * converts the alpha-2 `locations.countryCode` + device country via
 * `alpha2ToAlpha3` before building the context). Language codes are compared on
 * their BASE tag (`zh-Hans` → `zh`, `pt-BR` → `pt`) — a known, deliberate
 * tradeoff (a `zh-Hant` article matches a `zh-Hans` user), consistent with the
 * existing translation-status logic.
 *
 * source-pref: the same context also carries the user's EXPLICIT source
 * preferences (`preferredPublications` / `preferredCountriesAlpha3`), consumed
 * by `sourcePriorityTier`. They ride this one object rather than a second
 * parallel context precisely so the two cannot drift — every surface that
 * already resolves geo/language gets source preferences for free.
 *
 * Fail-open contract: a `null` context (the loader failed, or nothing is known
 * about the user) collapses every geo tier to 3, every source tier to 2 and
 * every rank to `Infinity`, so the call site's existing tiebreaks decide alone —
 * byte-identical to the pre-priority behavior. Empty preference sets give the
 * same guarantee for `sourcePriorityTier` specifically.
 */

/**
 * The user's geo/language signals, resolved once per run from on-device state.
 * All country codes are ISO ALPHA-3 (already normalized upper-case); the
 * language is a BASE tag (`baseLang`-normalized) or null.
 */

/** The minimal geo/language tag a rankable item carries (decoupled from any model). */

/**
 * The minimal source tag a SOURCE-PREFERENCE-rankable item carries. Both fields
 * already travel on `ForYouSuggestion` (`publication_name` / `country_code`) and
 * on `RelatedSortable` (`publicationName` / `countryCodeAlpha3`), so nothing new
 * has to be threaded through any call site.
 */

/**
 * Normalize a publication name to the comparable form used by
 * `publication-preference-service.normalizePublicationName`:
 * `toLowerCase().trim()` with internal whitespace collapsed. Empty ⇒ null.
 * Never throws.
 */
function normPublicationName(name) {
  const n = (name ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
  return n === '' ? null : n;
}

/**
 * Base-language tag of a code: `trim().toLowerCase().split('-')[0]`, with an
 * empty result mapped to null. `zh-Hans` → `zh`, `EN` → `en`, `''`/null → null.
 * Never throws.
 */
function baseLang(code) {
  const base = (code ?? '').trim().toLowerCase().split('-')[0];
  return base === '' ? null : base;
}

/**
 * Normalize a country code to the comparable ISO alpha-3 form:
 * `trim().toUpperCase()`, with an empty result mapped to null. Never throws.
 * (Does NOT convert alpha-2 → alpha-3 — that is the loader's job; this only
 * canonicalizes an already-alpha-3 string for comparison.)
 */
function normAlpha3(code) {
  const a3 = (code ?? '').trim().toUpperCase();
  return a3 === '' ? null : a3;
}

/** The user's countries in priority order: `[home, ...others]`, null home dropped. */
function rankedCountries(ctx) {
  return ctx.homeCountryAlpha3 !== null ? [ctx.homeCountryAlpha3, ...ctx.otherCountriesAlpha3] : ctx.otherCountriesAlpha3;
}

/**
 * Priority tier of an item against the user's context (lower = higher priority):
 *
 *   0 — HOME country (item's alpha-3 === `ctx.homeCountryAlpha3`)
 *   1 — another of the USER's countries (item's alpha-3 ∈ `otherCountriesAlpha3`)
 *   2 — the user's APP language (base compare; only when no country match)
 *   3 — everything else (incl. null country/language)
 *
 * Country beats language: a home-country article in a foreign language is still
 * tier 0. `ctx === null` → always tier 3 (universal fail-open — legacy behavior).
 * Never throws.
 */
function repPriorityTier(item, ctx) {
  if (ctx === null) {
    return 3;
  }
  const country = normAlpha3(item.countryCodeAlpha3);
  if (country !== null) {
    if (ctx.homeCountryAlpha3 !== null && country === ctx.homeCountryAlpha3) {
      return 0;
    }
    // Set membership for the "other user country" test — O(1) regardless of
    // how many countries the user has.
    const others = new Set(ctx.otherCountriesAlpha3);
    if (others.has(country)) {
      return 1;
    }
  }
  const lang = baseLang(item.languageCode);
  if (lang !== null && ctx.appLanguageBase !== null && lang === ctx.appLanguageBase) {
    return 2;
  }
  return 3;
}

/**
 * source-pref. How strongly the user has asked for THIS item's source
 * (lower = more preferred):
 *
 *   0 — the item's publication is one the user explicitly prefers by NAME.
 *   1 — the item's country is inside a preferred source SCOPE ("Indian sources").
 *   2 — neither.
 *
 * A named publication beats a scope: "more from the Times of India" is a
 * narrower, more deliberate statement than "more from Indian sources", so when
 * both fire the named one wins the representative slot.
 *
 * This is DELIBERATELY not a score term. `W_PUB` is 0.076 — a boost there
 * contributes ≈ +0.040 against a topic match's +0.365, and it is inert in prod
 * anyway because every article takes the legacy LLM path and the math score is
 * discarded. "Prefer" therefore means: choose the representative, and top the
 * related list. Ordering by importance is untouched.
 *
 * `ctx === null`, or both preference sets empty, ⇒ always tier 2, which makes
 * every downstream comparator byte-identical to its pre-source-pref behaviour.
 * Never throws.
 */
function sourcePriorityTier(item, ctx) {
  if (ctx === null) {
    return 2;
  }
  const pubs = ctx.preferredPublications;
  const countries = ctx.preferredCountriesAlpha3;
  // Cheap exit for the overwhelmingly common case (no preferences expressed,
  // or a context built before this feature existed), and the thing that makes
  // the byte-identity guarantee obvious rather than emergent from two set
  // lookups that happen to miss.
  if ((pubs === undefined || pubs.size === 0) && (countries === undefined || countries.size === 0)) {
    return 2;
  }
  const pub = normPublicationName(item.publicationName);
  if (pub !== null && pubs !== undefined && pubs.has(pub)) {
    return 0;
  }
  const country = normAlpha3(item.countryCodeAlpha3);
  if (country !== null && countries !== undefined && countries.has(country)) {
    return 1;
  }
  return 2;
}

/**
 * Rank of a country within the user's priority list `[home, ...otherCountries]`:
 * the home country is 0, the first other country 1, and so on. Returns
 * `Infinity` for a country not in the list, a null/empty code, or a null
 * context (unranked sorts last). Shared with the Related-Articles sort.
 * Never throws.
 */
function countryRank(alpha3, ctx) {
  if (ctx === null) {
    return Infinity;
  }
  const country = normAlpha3(alpha3);
  if (country === null) {
    return Infinity;
  }
  const idx = rankedCountries(ctx).indexOf(country);
  return idx === -1 ? Infinity : idx;
}