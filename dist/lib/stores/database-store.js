"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useDatabaseStore = exports.useDatabaseReady = void 0;
var _zustand = require("zustand");
/**
 * In-memory gating for WatermelonDB. `ready` is only true AFTER migrations
 * have run. Callers that hit the DB should bail if this is false.
 * Process-local so a crash resets it to false on cold start.
 */

const useDatabaseStore = exports.useDatabaseStore = (0, _zustand.create)(set => ({
  ready: false,
  setReady: value => set({
    ready: value
  })
}));
const useDatabaseReady = () => useDatabaseStore(s => s.ready);
exports.useDatabaseReady = useDatabaseReady;