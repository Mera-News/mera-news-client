"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.authClient = void 0;
exports.getJwtToken = getJwtToken;
exports.invalidateJwtCache = invalidateJwtCache;
exports.onAppForeground = onAppForeground;
exports.onNetworkReconnect = onNetworkReconnect;
exports.recordAuthFailure = recordAuthFailure;
var _index = require("./index");
// Stands in for the app's lib/auth-client and lib/auth-failure-breaker: the Mera account session.

const auth = () => (0, _index.platform)('auth').auth;
function getJwtToken() {
  return auth().getJwtToken();
}
function invalidateJwtCache() {
  auth().invalidateJwtCache();
}
const authClient = exports.authClient = {
  getCookie() {
    return auth().getCookie();
  }
};
function recordAuthFailure() {
  auth().recordAuthFailure();
}
function onAppForeground() {
  auth().onAppForeground?.();
}
function onNetworkReconnect() {
  auth().onNetworkReconnect?.();
}