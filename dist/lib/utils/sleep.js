"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.sleep = sleep;
/** A plain timer wait; it does not observe an AbortSignal. A leaf module (no imports) on purpose:
 *  importing it must never pull anything into an import cycle (scripts/codemods/cycles.ts). */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}