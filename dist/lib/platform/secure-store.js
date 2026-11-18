"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.secureStore = void 0;
var _index = require("./index");
// Stands in for the app's lib/utils/secure-store-adapter: the keychain, with the host's own
// accessibility settings. A missing item resolves null; a transient failure rejects.

const secureStore = exports.secureStore = (0, _index.forward)('secure-store', host => host.secureStore);