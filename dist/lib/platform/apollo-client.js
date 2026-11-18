"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _index = require("./index");
// Stands in for the app's lib/apollo-client (default export: the GraphQL client).

const client = (0, _index.forward)('apollo-client', host => host.apolloClient);
var _default = exports.default = client;