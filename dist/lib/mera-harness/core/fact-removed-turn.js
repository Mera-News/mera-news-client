"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.factRemovedPrompt = factRemovedPrompt;
exports.factRemovedReplyOk = factRemovedReplyOk;
exports.runFactRemovedTurn = runFactRemovedTurn;
var _backReference = require("./back-reference");
var _prose = require("./prose");
var _routerPrompt = require("./router-prompt");
var _stateLine = require("./state-line");
// The turn that tells the reader a fact is gone. The app has already removed it
// (a topic run completed empty), so this is one tool-free leg: never routed,
// never a user message, and nothing it says can stage or change anything.
//
// The note is the system prompt, not a message, so it cannot reach `<recent>`.
// The reply is checked in code, and a bad one gives way to the caller's fixed
// line: prose emphasis is not a lever on this model.

const REPLY_MAX_TOKENS = 300;
function factRemovedPrompt(statements, languageName) {
  const facts = statements.map(s => `"${(0, _stateLine.escapeUntrusted)(s, 200)}"`).join(', ');
  return `You are Mera. You keep a news profile for the user.

The app has already removed from their profile: ${facts}. It could not make any news topics from it. That is done and nothing else changed.

Write one short message that does these three things, in this order:
1. Says you removed it, quoting it exactly as written above.
2. Says why: you could not turn it into news topics. If the fact itself shows a clear reason, add it in a few plain words, such as that it describes the person rather than a subject the news covers. If no reason is clear, say only the first part. Never invent a reason.
3. Asks what they would like you to save instead.

Do not apologise. Do not offer anything else. Never say you saved or added anything.

${(0, _routerPrompt.voiceRules)(languageName)}`;
}
const fold = s => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** The prompt's own English phrases, in a reply that should not be English. Quoted facts stay English. */
const ENGLISH_REPLY = /\b(?:i removed|i have removed|news topics|would you like)\b/i;

/** Staging wrote Dutch in English and Hindi in Latin letters, 2 of 3 runs each, despite the rule. */
function inTheReaderLanguage(reply, languageName) {
  if (!languageName || languageName === 'English') return true;
  if (languageName === 'Hindi' && !/\p{Script=Devanagari}/u.test(reply)) return false;
  return !ENGLISH_REPLY.test(reply);
}

/** Names every fact, asks something, and carries no leak or false claim. */
function factRemovedReplyOk(reply, statements, languageName) {
  const text = fold(reply);
  return text.length > 0 && inTheReaderLanguage(reply, languageName) && /[?？؟]/.test(reply) && statements.every(s => text.includes(fold(s))) && !(0, _prose.leaksInternals)(reply) && !(0, _prose.claimsSaveHappened)(reply) && !(0, _prose.claimsChangeHappened)(reply);
}

/**
 * One leg. A stopped call resolves with an empty reply, a transport failure
 * throws to the caller's failed-turn path, and `turn` learns the reply as an
 * exchange with no user half, so the next message reads as its answer.
 */
async function runFactRemovedTurn(params) {
  const called = await params.callModel({
    role: 'reply',
    model: 'BIG',
    systemPrompt: factRemovedPrompt(params.statements, params.languageName),
    messages: [{
      role: 'user',
      content: `Write the message now${params.languageName ? `, in ${params.languageName}` : ''}.`
    }],
    tools: [],
    maxTokens: REPLY_MAX_TOKENS,
    enableThinking: false
  });
  if (called.error) return {
    reply: '',
    usedFallback: false,
    stopped: true
  };
  const text = (0, _prose.cleanProse)(called.content);
  const usedFallback = called.truncated || !factRemovedReplyOk(text, params.statements, params.languageName);
  const reply = usedFallback ? params.fallback : text;
  if (params.turn) {
    params.turn.lastReply = reply;
    params.turn.lastQuestion = (0, _prose.trailingQuestion)(reply);
    params.turn.recentExchanges = (0, _backReference.withExchange)(params.turn.recentExchanges, '', reply);
  }
  return {
    reply,
    usedFallback,
    stopped: false
  };
}