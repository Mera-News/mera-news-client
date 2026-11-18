"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ORIGIN_KEY = exports.EXPAT_KEY = exports.COMBINED_ORIGIN_KEY = exports.CANONICAL_LOCATION_KEY = void 0;
exports.countryOf = countryOf;
exports.expatStatement = expatStatement;
exports.isCombinedOriginFact = isCombinedOriginFact;
exports.isExpatStatement = isExpatStatement;
exports.isOriginStatement = isOriginStatement;
exports.originCountry = originCountry;
exports.sameCountry = sameCountry;
exports.splitCombinedFact = splitCombinedFact;
exports.threeFactsOf = threeFactsOf;
exports.toOriginStatement = toOriginStatement;
// mera-harness/core — the retired "origin plus residence" fact. PURE.
//
// Origin and residence used to be composed into ONE fact ("Expat from India
// living in Amsterdam, Netherlands, EU") under its own key. That fact carried
// the user's home without the home key, so a later move replaced the
// residence fact and left the combined one naming the old city (an audit
// found it), and an origin turn could replace the real residence fact with it.
// Owner ruling: stop combining. Existing combined facts get ONE offer to split.

/** The key every combined fact was written under (`facts/origin.md`). */
const COMBINED_ORIGIN_KEY = exports.COMBINED_ORIGIN_KEY = 'background: origin and current residence';

/** Where the user is from, on its own. Not a questionnaire key: none exists
 *  for origin, and `nationality` claims citizenship the user may not have. */
const ORIGIN_KEY = exports.ORIGIN_KEY = 'background: country of origin';

/** The canonical home key, byte for byte. The topic generator's tier-1
 *  location resolver matches this exact string. */
const CANONICAL_LOCATION_KEY = exports.CANONICAL_LOCATION_KEY = 'location: neighborhood/area, city, and country (preserve specifics)';
function isCombinedOriginFact(attribute) {
  return typeof attribute === 'string' && attribute.trim().toLowerCase() === COMBINED_ORIGIN_KEY;
}

/**
 * Split a combined statement into its two halves, or null when it does not
 * have the combined shape.
 *
 * "Expat from India living in Amsterdam, Netherlands, EU" gives
 * { origin: "Expat from India", residence: "Lives in Amsterdam, Netherlands, EU" }.
 * "Expat originally from India" (the no-city form) has no residence half and
 * gives null: it is already an origin fact in all but its key.
 */
function splitCombinedFact(statement) {
  const m = /^(.*?\S)\s*,?\s+(?:living|based|settled|residing)\s+in\s+(.+?)\s*\.?$/i.exec((statement ?? '').trim());
  if (!m) return null;
  const origin = m[1].trim();
  const place = m[2].trim();
  if (!origin || !place) return null;
  return {
    origin,
    residence: `Lives in ${place}`
  };
}

// ---------------------------------------------------------------------------
// THREE FACTS FOR AN EXPAT (owner decision). Origin, expat status and
// residence are separate, each with its own key, each manageable on its own.
// ---------------------------------------------------------------------------

/** Expat status: which country the user lives in as someone from elsewhere.
 *  "Expat in The Netherlands". Changes only when the COUNTRY changes. */
const EXPAT_KEY = exports.EXPAT_KEY = 'background: expat in country of residence';

/** Blocs and continents: the top rung of a place chain, never a country. */
const NOT_A_COUNTRY = new Set(['eu', 'eea', 'efta', 'europe', 'asia', 'africa', 'north america', 'south america', 'oceania', 'antarctica']);

/** "Expat from India" or "Expat originally from Kerala, India" gives
 *  "From India" / "From Kerala, India". A text with no "from" is returned as is. */
function toOriginStatement(originHalf) {
  const m = /\bfrom\s+(.+?)\s*\.?$/i.exec((originHalf ?? '').trim());
  return m ? `From ${m[1].trim()}` : (originHalf ?? '').trim();
}

/**
 * The country of a place statement, or null when it cannot be KNOWN.
 *
 * Read from a RESOLVED chain only: one that ends in a bloc ("..., Germany,
 * EU"), which is how every looked-up place is written, so the rung before the
 * bloc is the country. Or from a place the lookup actually returned whose
 * locality appears in the statement. Never the last rung of an unresolved
 * text: "Nieuw-West, Amsterdam" gave "Expat in Amsterdam" on staging.
 */
function countryOf(statement, known = []) {
  const text = (statement ?? '').replace(/^(?:lives|living|based|resides?)\s+in\s+/i, '');
  const rungs = text.split(',').map(r => r.trim().replace(/\.$/, '')).filter(Boolean);
  if (rungs.length >= 2 && NOT_A_COUNTRY.has(rungs[rungs.length - 1].toLowerCase())) {
    const country = rungs[rungs.length - 2];
    return NOT_A_COUNTRY.has(country.toLowerCase()) ? null : country;
  }
  const lower = text.toLowerCase();
  // The LONGEST place named wins, not the first: "Newcastle" is inside
  // "Newcastle-under-Lyme" (same trap as bindChoicePayloads).
  let hit = null;
  for (const p of known) {
    const name = p.locality?.toLowerCase();
    if (name && lower.includes(name) && (!hit || name.length > hit.locality.length)) hit = p;
  }
  return hit ? hit.countryName : null;
}

/** The country an origin statement names ("From Kerala, India" gives "India"). */
function originCountry(statement) {
  const rungs = (statement ?? '').replace(/^(?:expat\s+)?(?:originally\s+)?from\s+/i, '').split(',').map(r => r.trim().replace(/\.$/, '')).filter(Boolean);
  return rungs.length > 0 ? rungs[rungs.length - 1] : null;
}

/** Country names compared loosely: case and a leading "the" do not matter. */
function sameCountry(a, b) {
  const n = x => (x ?? '').trim().toLowerCase().replace(/^the\s+/, '');
  return n(a) !== '' && n(a) === n(b);
}
function expatStatement(country) {
  return `Expat in ${country}`;
}
function isOriginStatement(statement) {
  return /^(?:expat\s+)?(?:originally\s+)?from\b/i.test((statement ?? '').trim());
}
function isExpatStatement(statement) {
  return /^expat\s+(?:living\s+)?in\b/i.test((statement ?? '').trim());
}

/**
 * The three facts a combined origin-and-home statement stands for, in order:
 * origin, expat status (only when the two countries differ), residence.
 * Null when the statement does not have the combined shape.
 */
function threeFactsOf(statement, known = []) {
  const halves = splitCombinedFact(statement);
  if (!halves) return null;
  const origin = toOriginStatement(halves.origin);
  const country = countryOf(halves.residence, known);
  const expat = country && !sameCountry(country, originCountry(origin)) ? expatStatement(country) : null;
  return {
    origin,
    expat,
    residence: halves.residence
  };
}