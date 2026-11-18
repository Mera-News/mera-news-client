"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NOTE_SYSTEM = exports.NOTE_CONTEXT_MAX_TOKENS = void 0;
exports.buildNotePrompt = buildNotePrompt;
var _prompts = require("../../prompts/prompts");
var _shared = require("../shared");
var _slots = require("../../../harnesses/slots");
// On-device notes: one sentence on why an article matters to the reader, for a
// row Kev has already scored. The cloud reason prompt teaches with real-world
// example sentences, which a small model copies; this one states the length,
// tone and grounding rules without examples. The note is plain text, read by
// parseReasonResult and kept only when it shares a word with the article
// (reason-grounding.ts).

const NOTE_SYSTEM = exports.NOTE_SYSTEM = _slots.DEVICE_SLOTS["notes/note-system"];

/**
 * Fact bank ceiling in tokens (countTokens), so a note fits Gemini Nano's ~4000-token input next
 * to the instruction and a 500-character title and description, whatever script the facts are in.
 * shortcut: keeps the bank's first facts; rank facts by the article if a long bank loses its notes.
 */
const NOTE_CONTEXT_MAX_TOKENS = exports.NOTE_CONTEXT_MAX_TOKENS = 2000;
function capUserContext(userContext) {
  if ((0, _shared.countTokens)(userContext) <= NOTE_CONTEXT_MAX_TOKENS) return userContext;
  const fit = (0, _shared.largestFitting)(userContext.length, n => (0, _shared.countTokens)(userContext.slice(0, n)) <= NOTE_CONTEXT_MAX_TOKENS);
  const cut = userContext.slice(0, fit);
  const lastFact = cut.lastIndexOf('. ');
  return lastFact > 0 ? cut.slice(0, lastFact + 1) : cut;
}
function buildNotePrompt(params) {
  return {
    system: NOTE_SYSTEM,
    prompt: (0, _prompts.buildLocalReasonUserMessage)({
      ...params,
      userContext: capUserContext(params.userContext)
    })
  };
}