"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.captureSpot = captureSpot;
var _index = require("./index");
// Stands in for the app's lib/navigation/resume-spot. A host with no screens has no spot to keep.

function captureSpot() {
  return (0, _index.platform)('resume-spot').captureSpot?.() ?? null;
}