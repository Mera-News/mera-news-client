"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _index = require("./index");
// Stands in for '@nozbe/watermelondb/adapters/sqlite' (default export). `new SQLiteAdapter(options)`
// returns the adapter the host builds from the same options: SQLite on a phone, anything on a server.

// A function called with `new` that returns an object yields that object.
const SQLiteAdapter = function SQLiteAdapter(options) {
  return (0, _index.platform)('sqlite-adapter').createDatabaseAdapter(options);
};
var _default = exports.default = SQLiteAdapter;