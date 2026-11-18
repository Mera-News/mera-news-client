"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.applyLanguage = applyLanguage;
exports.default = void 0;
var _index = require("./index");
// Stands in for the app's lib/i18n: the host's i18next instance (default export) and applyLanguage.

const i18n = (0, _index.forward)('i18n', host => host.i18n);

/** Switches the interface language. A host without one only changes i18next's language. */
function applyLanguage(lang) {
  const host = (0, _index.platform)('i18n');
  if (host.applyLanguage) host.applyLanguage(lang);else void host.i18n.changeLanguage(lang);
}
var _default = exports.default = i18n;