"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DevSettings = exports.AppState = void 0;
var _index = require("./index");
// Stands in for 'react-native': AppState and DevSettings.

const AppState = exports.AppState = (0, _index.forward)('react-native', host => host.appState);

/** Dev-only reload. A host without one ignores the call. */
const DevSettings = exports.DevSettings = {
  reload(reason) {
    (0, _index.platform)('react-native').devReload?.(reason);
  }
};