"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "IDENTITY_LINE", {
  enumerable: true,
  get: function () {
    return _identity.IDENTITY_LINE;
  }
});
exports.ON_DEVICE_CHAT_MAX_TOKENS = void 0;
exports.capWords = capWords;
exports.countTokens = countTokens;
exports.describePending = describePending;
exports.languageLine = languageLine;
exports.largestFitting = largestFitting;
exports.promptBudgetTokens = promptBudgetTokens;
exports.renderPrompt = renderPrompt;
exports.text = text;
var _proposals = require("../../core/proposals");
var _untrustedText = require("../../prompts/untrusted-text");
var _slots = require("../../../harnesses/slots");
var _template = require("../../../harnesses/template");
var _identity = require("../../../mera-harness/core/identity");
// Shared pieces of the on-device chat flows: the identity line, the
// token budget and the conversation renderer. Pure and RN-free, so the harness
// builds exactly the prompts the phone sends.

/** Output ceiling for one on-device chat turn: a short reply plus a few fields. */
const ON_DEVICE_CHAT_MAX_TOKENS = exports.ON_DEVICE_CHAT_MAX_TOKENS = 512;

/** Gemini Nano refuses input of 4,000 tokens or more; every engine is sized for it. */
const INPUT_TOKEN_CEILING = 4000;
/** contextSize() is null when the built-in model cannot say; assume the smallest window. */
const FALLBACK_CONTEXT_TOKENS = 4096;
/** Room for the structured retry's reminder line and chat-template overhead. */
const RESERVE_TOKENS = 96;

/**
 * A deliberately high token count: 3 ASCII characters per token, and one token
 * per other character. The app's estimateTokens assumes 4 characters per token
 * for everything but CJK, which undercounts Devanagari, Arabic or Cyrillic
 * badly against the built-in models' tokenizers.
 */
function countTokens(text) {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;else other++;
  }
  return Math.ceil(ascii / 3) + other;
}

/** The largest n in 0..max with fits(n), for a `fits` that stays true below any n where it holds. */
function largestFitting(max, fits) {
  let lo = 0;
  let hi = max;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if (fits(mid)) lo = mid;else hi = mid - 1;
  }
  return lo;
}

/**
 * Tokens left for the prompt (context plus conversation) once the system
 * instructions, the schema and the reply are paid for. `contextSize` is the
 * toolkit's value: the whole window for Apple, the input limit for Nano, so
 * `contextSize - maxTokens` is safe on both.
 */
function promptBudgetTokens(params) {
  const window = Math.min(INPUT_TOKEN_CEILING, (params.contextSize ?? FALLBACK_CONTEXT_TOKENS) - params.maxTokens);
  return window - RESERVE_TOKENS - countTokens(params.system) - countTokens(params.schemaJson ?? '');
}
/**
 * The prompt for one turn: the context block, then as much of the conversation
 * as fits in `budgetTokens`, dropping the oldest turns first. The last user turn
 * always stays, cut to fit when even it alone is too long.
 */
function renderPrompt(context, history, budgetTokens) {
  const head = context ? `${context}\n\nConversation:` : 'Conversation:';
  let left = budgetTokens - countTokens(head) - 1;
  const lines = [];
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    let line = `${turn.role === 'user' ? 'User' : 'Mera'}: ${turn.content.trim()}`;
    const cost = countTokens(line) + 1;
    if (cost > left) {
      if (i !== lastUser) break;
      // Cut by characters until it fits: never more than the budget allows.
      while (line.length > 0 && countTokens(line) + 1 > left) line = line.slice(0, Math.floor(line.length * 0.9));
      if (line) lines.unshift(line);
      break;
    }
    lines.unshift(line);
    left -= cost;
  }
  return `${head}\n${lines.join('\n')}`;
}

/** The reply-language rule, plus the one punctuation rule for user-facing copy. */
function languageLine(languageName) {
  return (0, _template.render)(_slots.DEVICE_SLOTS["shared/language-line"], {
    languageName
  });
}

/** One executor tool an on-device turn asks the app to run, by its existing name and input shape. */

/** What a structured on-device turn resolves to: the reply for the bubble and the tools to run. */

/** Trimmed string or '' for anything that is not a string. */
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Whitespace-separated words, for the label and search word caps. */
function capWords(value, max) {
  return value.split(/\s+/).filter(Boolean).slice(0, max).join(' ');
}

/**
 * The card still waiting on the user, for the context block. A card of
 * alternatives (story options, choose-one) is picked by a tap only, so the
 * model is told its yes does nothing there.
 */
function describePending(proposal) {
  if (!proposal || proposal.actions.length === 0) return null;
  const labels = proposal.actions.map(a => a.type === 'track_story' ? a.label : '').filter(Boolean);
  const what = (0, _untrustedText.asUntrusted)(labels.length > 0 ? labels.join('; ') : proposal.explanation, 400);
  if ((0, _proposals.isTrackCard)(proposal) && (0, _proposals.proposalRequiresUserChoice)(proposal)) {
    return `A card on screen offers: ${what}. The user must ${_proposals.TRACK_CARD_TAP_PHRASE} on the card; a typed yes cannot apply it.`;
  }
  return (0, _proposals.proposalRequiresUserChoice)(proposal) ? `A card on screen offers: ${what}. The user picks one by tapping it; a typed yes cannot apply it.` : `A change is waiting for the user's yes or no: ${what}`;
}