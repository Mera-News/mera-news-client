"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildPubPrefs = buildPubPrefs;
exports.normCountry = normCountry;
exports.normText = normText;
exports.normalizeLocation = normalizeLocation;
// scoring-engine — the plain, RN-free persona snapshot the deterministic
// relevance math runs against, plus the normalizers that produce it.
//
// Nothing here touches WatermelonDB, zustand, or expo — the RN-coupled services
// (topic-service, location-service, …) build these plain snapshots and hand
// them to computeRelevance(). Every matching key (city/region/entity/publication)
// is normalized the SAME way the server tagging normalizes (trim + lowercase;
// country codes upper-cased) so on-device geo/entity/pub matching lines up with
// the tags Gemini produced server-side.

/** Lower-cased, trimmed matching key (city, region, entity, publication). */
function normText(v) {
  return (v ?? '').trim().toLowerCase();
}

/** Upper-cased, trimmed ISO country code. */
function normCountry(v) {
  return (v ?? '').trim().toUpperCase();
}

/** A role-tagged place entity the scorer needs (subset of the WMDB `locations`
 *  row — no provenance/timestamps). city/region are normalized keys. */

/** What a suppression matches against. Mirrors `SUPPRESSION_KINDS` in
 *  `lib/database/models/PersonaSuppression` (duplicated here so the engine
 *  stays RN-free / DB-free). An absent kind means 'keyword'. */

/**
 * One suppression as the engine sees it. The SAME shape carries both flavours —
 * the hard/soft split is made once by the persona loader (by comparing
 * `strength` against the DB service's HARD_SUPPRESSION_STRENGTH) and surfaces
 * here as two separate lists:
 *
 *  - `softSuppressions` → a capped score penalty (relevance.ts).
 *  - `hardSuppressions` → the candidate is screened out entirely, before any
 *    math or judge work (scoring-engine/suppression.ts::screenHardSuppressions,
 *    called from both orchestrators).
 *
 * Matching for every kind lives in `scoring-engine/suppression.ts`.
 */

/** The plain persona snapshot computeRelevance() reads. Never leaves the device;
 *  the server never sees weights, negatives, locations, or suppressions. */

/** Normalize a location snapshot's matching keys in place-safe fashion. */
function normalizeLocation(loc) {
  return {
    ...loc,
    city: loc.city ? normText(loc.city) : undefined,
    region: loc.region ? normText(loc.region) : undefined,
    countryCode: normCountry(loc.countryCode)
  };
}

/**
 * Build a normalized pub-pref map from raw {name, weight} rows.
 *
 * source-pref v47: a row carrying a `scopeKind` is a live SOURCE SCOPE
 * ("Indian sources"), whose `publicationName` is a human label rather than a
 * publication, and whose effect is a render-time representative/ordering
 * preference — never a `W_PUB` score term. Such rows are SKIPPED here as well
 * as at the caller, so neither layer alone is load-bearing.
 */
function buildPubPrefs(rows) {
  const m = new Map();
  for (const r of rows) {
    if (r.scopeKind != null) continue;
    const key = normText(r.publicationName);
    if (key) m.set(key, r.weight);
  }
  return m;
}