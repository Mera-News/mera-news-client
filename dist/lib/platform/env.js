"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.env = void 0;
var _index = require("./index");
// Build-time configuration by name, from the host (`env.EXPO_PUBLIC_INFERENCE_ENDPOINT`). Stands in
// for `process.env`, which a bundler may not inline inside a dependency. Read at the time of access.

const env = exports.env = (0, _index.forward)('env', host => host.env);