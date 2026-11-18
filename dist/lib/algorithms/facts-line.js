"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FACTS_SEPARATOR = void 0;
exports.factsLine = factsLine;
exports.titleCaseWords = titleCaseWords;
// The matched facts as one line for the note box (owner, 2026-10-21): each fact
// in Title Case, joined by a middle dot, because a fact can carry commas of its
// own ("Lives in Nieuw-West, Amsterdam, ..."). Title Case only RAISES the first
// letter of each word, so acronyms and brand casing survive ("AI-curated",
// "FC Chelsea", "F1").

const FACTS_SEPARATOR = exports.FACTS_SEPARATOR = ' · ';
function titleCaseWords(text) {
  return text.replace(/(^|\s)(\p{Ll})/gu, (_, gap, letter) => gap + letter.toLocaleUpperCase());
}
function factsLine(statements) {
  const seen = new Set();
  const parts = [];
  for (const raw of statements) {
    const s = titleCaseWords(raw.trim());
    if (!s || seen.has(s)) continue;
    seen.add(s);
    parts.push(s);
  }
  return parts.join(FACTS_SEPARATOR);
}