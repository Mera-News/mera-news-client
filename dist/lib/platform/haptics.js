"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.hapticLight = hapticLight;
var _index = require("./index");
// Stands in for the app's lib/haptics. Does nothing on a host without haptics.

function hapticLight() {
  return (0, _index.platform)('haptics').hapticLight?.() ?? Promise.resolve();
}