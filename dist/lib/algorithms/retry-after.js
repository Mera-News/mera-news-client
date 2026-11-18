"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.retryAfterMs = retryAfterMs;
/** Parse a `Retry-After` header value (integer seconds) into ms, clamped to `maxMs`.
 *  Absent, empty, non-numeric or non-positive values fall back to `defaultMs`. */
function retryAfterMs(raw, opts) {
  const seconds = raw != null ? Number(raw) : NaN;
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : opts.defaultMs;
  return Math.min(ms, opts.maxMs);
}