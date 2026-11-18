"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getLocales = getLocales;
var _index = require("./index");
// Stands in for 'expo-localization'.

function getLocales() {
  return (0, _index.platform)('localization').getLocales();
}