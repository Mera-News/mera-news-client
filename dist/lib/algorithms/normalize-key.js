"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.normalizeKey = normalizeKey;
exports.normalizeKeyOrEmpty = normalizeKeyOrEmpty;
/** Case-insensitive, whitespace-collapsed comparison key. */
function normalizeKey(s) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}
function normalizeKeyOrEmpty(s) {
  return normalizeKey(s ?? '');
}