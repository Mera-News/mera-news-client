"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _index = require("./index");
// Stands in for '@react-native-community/netinfo' (default export). Throws while loading when the
// host has no network module, which callers that load it in a try read as "module absent".

const host = (0, _index.platform)('netinfo');
if (!host.netInfo) throw new Error('The host provides no network status (lib/platform/netinfo)');
const NetInfo = {
  fetch: () => (0, _index.platform)('netinfo').netInfo.fetch(),
  addEventListener: listener => (0, _index.platform)('netinfo').netInfo.addEventListener(listener)
};
var _default = exports.default = NetInfo;