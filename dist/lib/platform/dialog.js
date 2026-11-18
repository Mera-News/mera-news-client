"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.showDialog = showDialog;
var _index = require("./index");
// Stands in for the app's lib/dialog. A host without dialogs answers as if the reader declined.

function showDialog(options) {
  return (0, _index.platform)('dialog').showDialog?.(options) ?? Promise.resolve(false);
}