"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isMutedPublication = isMutedPublication;
exports.publicationTagMultiplier = publicationTagMultiplier;
exports.rankedRelevance = rankedRelevance;
var _config = require("../news-harness/core/config");
var _geoLanguagePriority = require("../algorithms/geo-language-priority");
// Publication tags weigh the feed (owner): Preferred ×1.5, Subscribed ×2, a
// stored Fewer ×0.5, Not preferred skips. Subscribed combines with one of the
// others by multiplying (Subscribed + Fewer = 1.0); Not preferred wins at 0.
//
// A preferred country gives its publications ×1.5. A publication with any tag of
// its own keeps that tag's multiplier instead: the two never stack.
//
// RANKING ONLY. The multiplier moves the band a row SORTS in; the chip, the
// visibility gate and the note keep the raw score, so Fewer sinks a story but
// never hides it and Subscribed lifts one but never shows a below-gate one.
// Nothing is persisted: a tag change applies at the next Feed session, from the
// session's context, and undoes cleanly.
//
// Kept out of `lib/algorithms/geo-language-priority.ts` on purpose: that file
// is mirrored by the server's related sort, and this rule is the app's alone.
//
// Pure: no RN, database or store imports.

const PUBLICATION_TAG_MULTIPLIER = {
  more: 1.5,
  fewer: 0.5,
  subscribed: 2
};

/** The geo/language context plus the one map of publication multipliers
 *  (normalised name → multiplier; 0 = muted). An entry of 1 is kept: a tagged
 *  publication's own tags outrank its country. */

/** One publication's multiplier from its tags. */
function publicationTagMultiplier(pref, subscribed) {
  if (pref === 'mute') return 0;
  const m = PUBLICATION_TAG_MULTIPLIER;
  const prefM = pref === 'more' ? m.more : pref === 'fewer' ? m.fewer : 1;
  return (subscribed ? m.subscribed : 1) * prefM;
}

/** The multiplier a publication's own tags give it; undefined when it has none. */
function namedMultiplier(publicationName, ctx) {
  const key = (0, _geoLanguagePriority.normPublicationName)(publicationName);
  return key === null ? undefined : ctx?.publicationMultipliers?.get(key);
}

/** The part of a row the sort weighs. */

function isPreferredCountry(countryCode, ctx) {
  const country = (0, _geoLanguagePriority.normAlpha3)(countryCode);
  return country !== null && ctx?.preferredCountriesAlpha3?.has(country) === true;
}

/** Mute means skip: the row leaves every Feed list. */
function isMutedPublication(publicationName, ctx) {
  return namedMultiplier(publicationName, ctx) === 0;
}

/**
 * The relevance a row SORTS by. An EMERGENCY row (above the emergency cutoff)
 * is never weighted, and a weighted row is capped AT the cutoff, so a tag can
 * never make a story an emergency (0.6 × 2 would read as 1.2).
 */
function rankedRelevance(relevance, row, ctx, cutoff = _config.DEFAULT_HARNESS_CONFIG.articlePipeline.emergencyPriorityCutoff) {
  if (relevance > cutoff) return relevance;
  const m = namedMultiplier(row.publication_name, ctx) ?? (isPreferredCountry(row.country_code, ctx) ? PUBLICATION_TAG_MULTIPLIER.more : 1);
  return m === 1 ? relevance : Math.min(relevance * m, cutoff);
}