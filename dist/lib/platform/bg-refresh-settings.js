"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.recordForeground = recordForeground;
var _index = require("./index");
// Stands in for the app's lib/background/bg-refresh-settings. Does nothing on a host without
// background refresh.

function recordForeground(at) {
  return (0, _index.platform)('bg-refresh-settings').recordForeground?.(at) ?? Promise.resolve();
}