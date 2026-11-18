"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NOTE = exports.INCLUDE = void 0;
exports.slotText = slotText;
/** A leading `<!-- ... -->` note for readers, dropped from a slot's text. */
const NOTE = exports.NOTE = /^<!--[\s\S]*?-->\n/;
/** `{{> id}}` includes another slot of the same folder. */
const INCLUDE = exports.INCLUDE = /\{\{> ([a-z0-9][a-z0-9/-]*)\}\}/g;

/** The slot text a file holds. Null when the file does not end with the one newline that is not part of it. */
function slotText(raw) {
  if (!raw.endsWith('\n')) return null;
  return raw.replace(NOTE, '').slice(0, -1);
}