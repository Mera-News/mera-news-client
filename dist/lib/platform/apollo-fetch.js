"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isRequestTimeoutError = isRequestTimeoutError;
var _index = require("./index");
// Stands in for the app's lib/apollo-fetch. A host without request timeouts never reports one.

function isRequestTimeoutError(error) {
  return (0, _index.platform)('apollo-fetch').isRequestTimeoutError?.(error) ?? false;
}