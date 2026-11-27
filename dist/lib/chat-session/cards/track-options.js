"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MAX_TRACK_CARD_OPTIONS = void 0;
exports.keptTrackKeys = keptTrackKeys;
exports.mergeTrackOptions = mergeTrackOptions;
exports.normaliseTrackText = normaliseTrackText;
exports.readCardOptions = readCardOptions;
exports.readPhraseHints = readPhraseHints;
exports.readTrackOutcomes = readTrackOutcomes;
exports.trackCardStatus = trackCardStatus;
exports.webQueryForCard = webQueryForCard;
var _engine = require("../engine");
var _meraHarness = require("../../mera-harness");
// The follow card's option list and per-row outcomes: pure, no RN.
//
// The card's tool-result override carries what the staged call cannot know:
// `cardOptions` (the list after More options grew it), `followed` (each row's
// outcome, written after each follow) and `dismissed` (Not now). The deriver
// reads them here, so a resumed chat redraws the card the reader left.

// The eval's own "too close" rule (eval/track-metrics.ts): one tokenizer, pure.

/** `subject`: the loop's handover put it first and ticks it. Unlike a phrase row it is
 *  translated, because the model writes most subjects in English. */

/** The hints on a card's result (`withReaderPhrase`, the handover's `storySubjects`); empty on any other card. */
function readPhraseHints(result) {
  const roles = {};
  if (Array.isArray(result.storySubjects)) {
    for (const s of result.storySubjects) if (typeof s === 'string') roles[normaliseTrackText(s)] = 'subject';
  }
  if (result.phraseRoles && typeof result.phraseRoles === 'object') {
    for (const [key, value] of Object.entries(result.phraseRoles)) {
      if (value === 'exact' || value === 'corrected') roles[key] = value;
    }
  }
  return {
    roles,
    defaultTick: typeof result.defaultTick === 'string' ? result.defaultTick : null
  };
}

/** The rows Regenerate with web search keeps: the reader's own words, the handover's subjects and every row with a follow outcome. */
function keptTrackKeys(result) {
  return new Set([...Object.keys(readPhraseHints(result).roles), ...Object.keys(readTrackOutcomes(result.followed))]);
}

/**
 * The one web query for a card, built with no model call: the reader's own
 * words when the card holds them, else the article's title, else the first
 * story row's search text. Null when nothing is long enough to search.
 */
function webQueryForCard(result, options, articleTitle) {
  const {
    roles
  } = readPhraseHints(result);
  const roleOf = o => {
    const key = normaliseTrackText(o.label);
    return Object.prototype.hasOwnProperty.call(roles, key) ? roles[key] : null;
  };
  const byRole = role => options.find(o => roleOf(o) === role)?.label;
  const story = options.find(o => roleOf(o) === null) ?? options[0];
  const query = (byRole('corrected') ?? byRole('exact') ?? byRole('subject') ?? (articleTitle?.trim() || story?.search) ?? '').trim().slice(0, 200);
  return query.length >= 2 ? query : null;
}

/** A card never grows past this: the engine contract's own cap. */
const MAX_TRACK_CARD_OPTIONS = exports.MAX_TRACK_CARD_OPTIONS = _engine.MAX_FOLLOW_OPTIONS;
/** Trimmed, lower case, whitespace collapsed: the key for labels and search texts alike. */
function normaliseTrackText(s) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * New options appended after the shown ones. An incoming option is a duplicate
 * when its label OR its search text matches one already on the card (or one
 * earlier in the same answer), or its label is a near-copy of one (content-word
 * Jaccard >= 0.6), so a reworded label adds nothing.
 */
function mergeTrackOptions(shown, incoming, cap = MAX_TRACK_CARD_OPTIONS) {
  const labels = new Set(shown.map(o => normaliseTrackText(o.label)));
  const searches = new Set(shown.map(o => normaliseTrackText(o.search)));
  const options = [...shown];
  for (const o of incoming) {
    if (options.length >= cap) break;
    const label = normaliseTrackText(o.label);
    const search = normaliseTrackText(o.search);
    if (!label || labels.has(label) || search && searches.has(search)) continue;
    if (options.some(k => (0, _meraHarness.contentJaccard)(o.label, k.label) >= _meraHarness.DETECT_JACCARD)) continue;
    labels.add(label);
    if (search) searches.add(search);
    options.push(o);
  }
  return {
    options,
    added: options.length - shown.length
  };
}

/**
 * The persisted `cardOptions`, or null when absent or malformed. A shape check
 * only: the options were cleaned when they were staged or merged.
 */
function readCardOptions(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const entry of raw) {
    const rec = entry;
    const label = typeof rec?.label === 'string' ? rec.label.trim() : '';
    if (!label) continue;
    const search = typeof rec?.search === 'string' && rec.search.trim() ? rec.search.trim() : label;
    out.push({
      label,
      search
    });
    if (out.length >= MAX_TRACK_CARD_OPTIONS) break;
  }
  return out.length > 0 ? out : null;
}

/** The persisted `followed` map (normalised label to outcome); unknown values dropped. */
function readTrackOutcomes(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (value === 'following' || value === 'already' || value === 'failed') out[key] = value;
  }
  return out;
}
/**
 * What the card shows. A card with a followed row is resolved and never flips
 * to expired; a failed row keeps it pending (Try again); only a card replaced
 * by a newer proposeTrack expires, and only while nothing on it was followed.
 */
function trackCardStatus(input) {
  const values = Object.values(input.outcomes);
  const succeeded = values.some(v => v !== 'failed');
  const failed = values.includes('failed');
  if (succeeded && (!failed || input.dismissed || input.superseded)) return 'followed';
  if (input.added) return 'addedToProfile';
  if (input.dismissed) return 'dismissed';
  if (input.superseded) return 'expired';
  return 'pending';
}