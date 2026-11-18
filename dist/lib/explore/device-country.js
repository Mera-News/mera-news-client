"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getDeviceCountryAlpha2 = getDeviceCountryAlpha2;
var _localization = require("../platform/localization");
// Explore tab — device-locale country resolver.
//
// Mirrors `resolveDeviceLocale` in lib/stores/app-language-store.ts, but reads
// the region (country) rather than the language. Returns ISO alpha-2 (e.g.
// 'US'), falling back to 'US' when the OS reports no region — matching the
// app's existing default-locale behaviour.

const FALLBACK_ALPHA2 = 'US';

/** The device region as an ISO alpha-2 country code (upper-cased). */
function getDeviceCountryAlpha2() {
  const region = (0, _localization.getLocales)()[0]?.regionCode;
  const trimmed = region?.trim();
  return trimmed ? trimmed.toUpperCase() : FALLBACK_ALPHA2;
}