"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isEnabled = void 0;
exports.reloadAsync = reloadAsync;
var _index = require("./index");
// Stands in for 'expo-updates', which callers require lazily (`require('@/lib/platform/updates')`).
// `isEnabled` is read once, when this module first loads; a host's answer does not change while it runs.
// A host without over-the-air updates is never enabled and cannot reload.

const isEnabled = exports.isEnabled = (0, _index.platform)('updates').updates?.isEnabled ?? false;
function reloadAsync() {
  const updates = (0, _index.platform)('updates').updates;
  return updates ? updates.reloadAsync() : Promise.reject(new Error('The host cannot reload (lib/platform/updates)'));
}