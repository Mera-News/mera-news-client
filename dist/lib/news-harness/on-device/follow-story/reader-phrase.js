"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isCloseToPhrase = isCloseToPhrase;
exports.phraseKey = phraseKey;
exports.readerPhrase = readerPhrase;
exports.withReaderPhrase = withReaderPhrase;
var _prose = require("../../../mera-harness/core/prose");
// The reader's own words on a follow card: APP CODE adds them, so they are there
// whatever the model wrote. Pure and RN-free; cloud and on-device share it.
//
// Slots, within the parser's cap of 4: [exact, corrected, story, story]. The
// corrected row is the model's option that passes `isCloseToPhrase`, wherever
// it put it. One that fails stays an ordinary story option. The two rows share
// one when they differ only by case or trailing punctuation.

/** MAX_TRACK_OPTIONS in the staging parser: built here, so it evicts neither phrase row. */
const TRACK_CARD_SLOTS = 4;
/** MAX_TRACK_CHARS in the staging parser. A longer text would be cut, so it is no longer their words. */
const MAX_PHRASE_CHARS = 200;

/** English only: any other language keeps the whole message, which is still their words. */
const LEAD_INS = [/^(?:yes|yeah|ok|okay)[,.]?\s+/i, /^(?:no[,.]?\s+)?i\s+meant\s+/i, /^(?:(?:please|can you|could you|would you)\s+)*(?:i(?:\s+would|['’]d)?\s+(?:want|like|wanna)\s+(?:you\s+)?(?:to\s+)?)?(?:keep me (?:updated|posted|informed)|update me|keep an eye|keep tabs|get updates|give me updates|updates?|news|follow|track(?!\s+and\b))(?:\s+(?:on|about|of|with))?\s+(?:the\s+(?:story|news)\s+(?:of|on|about)\s+)?/i];
const TRAILING_PLEASE = /[\s,]*please[.!]*$/i;
/** Names nothing: "this", "that story", "a story", "something else". */
const NAMES_NOTHING = /^(?:(?:this|that|these|those|it|them|the|a|an|one|some)\s*)?(?:story|stories|one|news|something|thing|topic)?(?:\s+else)?[.!?]*$/i;
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Rides the tool result: the option list itself passes through a parser that keeps label and search only. */

/** The same key as the card's `normaliseTrackText`. */
function phraseKey(s) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The story the reader named, in their words, or null when the message names none. */
function readerPhrase(message) {
  let phrase = (message ?? '').trim().replace(/\s+/g, ' ');
  for (const leadIn of LEAD_INS) phrase = phrase.replace(leadIn, '');
  phrase = phrase.replace(TRAILING_PLEASE, '').trim();
  if (!/\p{L}/u.test(phrase) || phrase.length > MAX_PHRASE_CHARS) return null;
  if (NAMES_NOTHING.test(phrase) || (0, _prose.isPlainYes)(phrase) || (0, _prose.isAcknowledgement)(phrase)) return null;
  return phrase;
}
function distance(a, b) {
  let prev = Array.from({
    length: b.length + 1
  }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    prev = row;
  }
  return prev[b.length];
}
const fold = s => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const nearWord = (a, b) => distance(a, b) <= (Math.min(a.length, b.length) >= 5 ? 2 : 1);

/** A filler the fix may add or drop: short and not an acronym that would be a new name. */
const isFiller = (word, raw) => word.length <= 3 && !raw.split(/\s+/).some(w => w.length > 1 && w === w.toUpperCase() && fold(w) === word);

/**
 * Same words, same meaning: every word on each side sits within a small edit
 * of a word on the other, so a new name, a rewrite or a translation fails.
 * Scripts written without spaces compare by character.
 */
function isCloseToPhrase(phrase, candidate) {
  const a = fold(phrase);
  const b = fold(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  if (NO_SPACE_SCRIPT.test(phrase)) return distance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 4));
  const aw = a.split(' ');
  const bw = b.split(' ');
  return aw.every(w => isFiller(w, phrase) || bw.some(o => nearWord(w, o))) && bw.every(w => isFiller(w, candidate) || aw.some(o => nearWord(w, o)));
}
const noTrailingPunctuation = s => phraseKey(s).replace(/[\s\p{P}]+$/u, '');
/** The words that make two labels one story: case, end punctuation and a leading English article aside. */
const sameStoryKey = s => noTrailingPunctuation(s).replace(/^(the|a|an) /, '');
function optionRows(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    const rec = typeof entry === 'string' ? {
      label: entry
    } : entry;
    const label = typeof rec?.label === 'string' ? rec.label.trim() : '';
    if (!label) return [];
    const search = typeof rec?.search === 'string' ? rec.search.trim() : '';
    return [{
      label,
      search: search || label
    }];
  });
}

/**
 * The card's options with the reader's words on it, or null when the message
 * names no story or the model offered nothing (it asked which story instead).
 * `appIsEnglish`: the exact row is ticked by default only for an English phrase
 * (app language en, all ASCII), because followed-story matching is in English.
 */
function withReaderPhrase(raw, message, appIsEnglish) {
  const phrase = readerPhrase(message);
  const rows = optionRows(raw);
  if (!phrase || rows.length === 0) return null;
  const at = rows.findIndex(o => isCloseToPhrase(phrase, o.label));
  const corrected = at >= 0 ? rows[at] : null;
  const stories = rows.filter((_, i) => i !== at);
  const exact = {
    label: phrase,
    search: phrase
  };
  const oneRow = corrected !== null && sameStoryKey(corrected.label) === sameStoryKey(phrase);
  const head = oneRow ? [corrected] : corrected ? [exact, corrected] : [exact];
  const taken = new Set(head.map(o => phraseKey(o.label)));
  const options = [...head, ...stories.filter(o => !taken.has(phraseKey(o.label)))].slice(0, TRACK_CARD_SLOTS);
  const phraseRoles = {};
  if (!oneRow || corrected?.label === phrase) phraseRoles[phraseKey(phrase)] = 'exact';
  if (corrected && corrected.label !== phrase) phraseRoles[phraseKey(corrected.label)] = 'corrected';
  const english = appIsEnglish && /^[ -~]*$/.test(phrase);
  const tick = corrected ?? (english ? exact : options[1] ?? exact);
  return {
    options,
    hints: {
      phraseRoles,
      defaultTick: phraseKey(tick.label)
    }
  };
}