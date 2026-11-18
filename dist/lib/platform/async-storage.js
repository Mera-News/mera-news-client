"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _index = require("./index");
// Stands in for '@react-native-async-storage/async-storage' (default export).

const AsyncStorage = (0, _index.forward)('async-storage', host => host.asyncStorage);
var _default = exports.default = AsyncStorage;