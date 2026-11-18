"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.activateKeepAwakeAsync = activateKeepAwakeAsync;
exports.deactivateKeepAwake = deactivateKeepAwake;
var _index = require("./index");
// Stands in for 'expo-keep-awake'. A host that never sleeps leaves keepAwake out: both calls do nothing.

function activateKeepAwakeAsync(tag) {
  return (0, _index.platform)('keep-awake').keepAwake?.activateKeepAwakeAsync(tag) ?? Promise.resolve();
}
function deactivateKeepAwake(tag) {
  return Promise.resolve((0, _index.platform)('keep-awake').keepAwake?.deactivateKeepAwake(tag));
}