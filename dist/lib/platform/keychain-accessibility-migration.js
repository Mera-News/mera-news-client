"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.runKeychainAccessibilityMigration = runKeychainAccessibilityMigration;
var _index = require("./index");
// Stands in for the app's lib/utils/keychain-accessibility-migration. A host without a keychain
// has nothing to migrate.

function runKeychainAccessibilityMigration() {
  return (0, _index.platform)('keychain-accessibility-migration').runKeychainAccessibilityMigration?.() ?? Promise.resolve('not-needed');
}