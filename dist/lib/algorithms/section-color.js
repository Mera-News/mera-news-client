"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.hashString = exports.SECTION_SATURATION_PCT = exports.SECTION_LIGHTNESS_PCT = void 0;
exports.sectionColorAtAlpha = sectionColorAtAlpha;
exports.sectionGradient = sectionGradient;
var _fnv1a = require("./fnv1a");
/** Gradient parameters for a fact-row header background. Consumed by the
 *  section-header renderer to composite a left-to-right fade. */

/** The fixed saturation/lightness pair every section colour uses — see
 *  `sectionGradient`'s dark-mode tuning note. Exported so a consumer building
 *  its own `hsla()` from `hue` cannot drift from `base`. */
const SECTION_SATURATION_PCT = exports.SECTION_SATURATION_PCT = 52;
const SECTION_LIGHTNESS_PCT = exports.SECTION_LIGHTNESS_PCT = 64;

/** FNV-1a 32-bit (see `lib/algorithms/fnv1a.ts`): deterministic, so a factId maps to the same colour everywhere. */
const hashString = exports.hashString = _fnv1a.fnv1a32;

/**
 * Derives a stable pastel gradient spec for a fact row's header, keyed by
 * factId. Dark-mode tuning rationale: the app is dark-mode only (near-black
 * ~#121113 background) with white header text. A moderate saturation (52%)
 * and high lightness (64%) reads as a soft pastel even before opacity is
 * applied, and once composited at the low `startOpacity` (0.30) used by the
 * gradient's solid edge, the result stays a gentle tint rather than a loud
 * accent. Fixing saturation/lightness and varying only hue guarantees every
 * possible hue (0-359) stays within the same safe brightness band, so text
 * contrast never depends on which factId happened to hash where — there's no
 * "unlucky" hue that comes out too dark or too neon.
 */
function sectionGradient(factId) {
  const hue = hashString(factId) % 360;
  return {
    base: `hsl(${hue}, ${SECTION_SATURATION_PCT}%, ${SECTION_LIGHTNESS_PCT}%)`,
    hue,
    startOpacity: 0.3,
    endOpacity: 0
  };
}

/** The same colour at an explicit alpha, as an `hsla()` literal. The form CSS
 *  gradient stops need — see `SectionGradientSpec.hue`. */
function sectionColorAtAlpha(hue, alpha) {
  return `hsla(${hue}, ${SECTION_SATURATION_PCT}%, ${SECTION_LIGHTNESS_PCT}%, ${alpha})`;
}