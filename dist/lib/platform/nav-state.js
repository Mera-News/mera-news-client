"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getCurrentPathname = getCurrentPathname;
var _index = require("./index");
// Stands in for the app's lib/nav-state. A host with no screens is on no route.

function getCurrentPathname() {
  return (0, _index.platform)('nav-state').getCurrentPathname?.() ?? '';
}