"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.devDump = devDump;
exports.hydrateHostState = hydrateHostState;
exports.resetHostState = resetHostState;
var _index = require("./index");
// The host's own steps inside the client's flows. Each does nothing when the host leaves it out.

/** Restores the host's own state; hydrateAllStores awaits it. May reject. */
function hydrateHostState() {
  return (0, _index.platform)('host').hydrateHostState?.() ?? Promise.resolve();
}

/** Clears the host's own state; clearAllStores awaits it last. */
function resetHostState() {
  return (0, _index.platform)('host').resetHostState?.() ?? Promise.resolve();
}

/** Development only: keeps a copy of a request the client sent, for reading by hand. */
function devDump(fileName, text) {
  (0, _index.platform)('host').devDump?.(fileName, text);
}