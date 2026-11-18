"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fetch = void 0;
var _index = require("./index");
// Stands in for 'expo/fetch': a fetch whose response body can be streamed.

const fetch = (input, init) => (0, _index.platform)('fetch').fetch(input, init);
exports.fetch = fetch;