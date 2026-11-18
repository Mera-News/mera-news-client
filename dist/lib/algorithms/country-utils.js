"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getFlagEmoji = exports.getCountryName = void 0;
var _i18nIsoCountries = _interopRequireDefault(require("i18n-iso-countries"));
var _en = _interopRequireDefault(require("i18n-iso-countries/langs/en.json"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
_i18nIsoCountries.default.registerLocale(_en.default);
const getFlagEmoji = alpha3Code => {
  if (!alpha3Code) return '';
  if (alpha3Code === 'GLOBAL') return '🌍';
  const alpha2 = _i18nIsoCountries.default.alpha3ToAlpha2(alpha3Code);
  if (!alpha2) return '';
  const codePoints = [...alpha2.toUpperCase()].map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

/**
 * Where the library's alias is an abbreviation, carries "The" or reads like
 * an official form (or, for Taiwan, where any other form would read
 * "Province of China"), the plain short name. Every other country keeps its alias ("Russia", "Vietnam",
 * "Iran"), which reads better than the official form.
 */
exports.getFlagEmoji = getFlagEmoji;
const NAME_OVERRIDES = {
  GB: 'United Kingdom',
  NL: 'Netherlands',
  AE: 'United Arab Emirates',
  GM: 'Gambia',
  TW: 'Taiwan',
  // Aliases that read like official forms.
  KR: 'South Korea',
  LA: 'Laos',
  SY: 'Syria'
};
const getCountryName = alpha3Code => {
  const alpha2 = _i18nIsoCountries.default.alpha3ToAlpha2(alpha3Code);
  return alpha2 && NAME_OVERRIDES[alpha2] || _i18nIsoCountries.default.getName(alpha3Code, 'en', {
    select: 'alias'
  }) || alpha3Code;
};
exports.getCountryName = getCountryName;