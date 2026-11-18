"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.askCall = askCall;
exports.askIfUnsure = askIfUnsure;
exports.collapse = collapse;
exports.conversationState = conversationState;
exports.decisionBlock = decisionBlock;
exports.newTrace = newTrace;
exports.readChat = readChat;
exports.replyOr = replyOr;
exports.timedDecide = timedDecide;
exports.vetoNegatedAgree = vetoNegatedAgree;
exports.write = write;
var _shared = require("../shared");
var _askChoice = require("./ask-choice");
var _decision = require("./decision");
var _rules = require("./rules");
// What every "Kev decides, the built-in model writes" chat turn shares:
// the ports, the thread read (a chip tap included), the unsure ask, and the
// writer call with its fixed fallback. Pure and RN-free: the app and the
// harness pass their own ports.

/** What the harness scores: the reading acted on (the top one when Mera asked) and the two steps' time. */

/** The thread as the agent receives it: tool calls are read for a chip tap. */

/** The ask_choice input Mera sends: chips plus the reading key behind each, so a tap maps back. */

const asRecord = v => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const strings = v => Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : '') : [];

/** Our own ask on an assistant turn (it carries `readings`); a cloud ask never does. */
function kevAskOf(message) {
  for (const call of message?.toolCalls ?? []) {
    if (call.name !== _askChoice.ASK_CHOICE_TOOL) continue;
    const input = asRecord(call.input);
    if (input && Array.isArray(input.readings)) {
      return {
        question: String(input.question ?? ''),
        options: strings(input.options),
        somethingElse: true,
        readings: strings(input.readings)
      };
    }
  }
  return null;
}
function readChat(messages) {
  const turns = messages.filter(m => m.content.trim().length > 0);
  const history = turns.map(m => ({
    role: m.role,
    content: m.content
  }));
  let last = turns.length - 1;
  while (last >= 0 && turns[last].role !== 'user') last--;
  if (last < 0) return {
    history,
    subject: '',
    earlier: [],
    tap: null
  };
  const message = turns[last].content.trim();
  // A tap answers the ask on the assistant turn right before it. The empty
  // filter above never drops it: the ask's bubble carries the question.
  const ask = turns[last - 1]?.role === 'assistant' ? kevAskOf(turns[last - 1]) : null;
  const labels = {};
  ask?.readings.forEach((key, i) => {
    if (key && ask.options[i]) labels[key] = ask.options[i];
  });
  const tap = ask ? (0, _askChoice.readingFromTap)(message, labels) : null;
  let subjectAt = last;
  if (tap) {
    subjectAt = last - 2;
    while (subjectAt >= 0 && turns[subjectAt].role !== 'user') subjectAt--;
  }
  if (subjectAt < 0) subjectAt = last;
  return {
    history,
    subject: turns[subjectAt].content.trim(),
    earlier: history.slice(0, subjectAt),
    tap
  };
}

/** The last few turns before the message, for Kev's state. Clipped: each question re-reads the whole state. */
function conversationState(earlier, max = 4) {
  return earlier.slice(-max).map(t => ({
    role: t.role === 'user' ? 'user' : 'mera',
    text: t.content.trim().slice(0, 300)
  }));
}

/**
 * The answer with readings that lead to the same act merged into one key, so
 * a close call between two of them is not a reason to ask. `groups` maps a
 * key to the key it merges into.
 */
function collapse(answer, groups) {
  const probabilities = {};
  for (const [key, p] of Object.entries(answer.probabilities)) {
    const into = groups[key] ?? key;
    probabilities[into] = (probabilities[into] ?? 0) + p;
  }
  return {
    probabilities
  };
}

/**
 * When the (collapsed) answer is unsure, the ask_choice call for its
 * likeliest labelled readings, else null. Null too when fewer than two
 * readings have a label: the flow then acts on its top reading.
 */
function askIfUnsure(answer, labels, question) {
  if (!(0, _decision.isUnsure)(answer)) return null;
  return askCall(answer, labels, question);
}

/** The ask_choice call for the likeliest labelled readings, or null below two chips. */
function askCall(answer, labels, question) {
  const ask = (0, _askChoice.buildAskChoice)(answer, labels, question);
  if (!ask) return null;
  const input = {
    ...ask,
    readings: ask.options.map(o => (0, _askChoice.readingFromTap)(o, labels) ?? '')
  };
  return {
    name: _askChoice.ASK_CHOICE_TOOL,
    input: input
  };
}

/**
 * Consent rule over Kev: an agree_to_card read from a message that says no
 * somewhere ("no wait, don't apply that yet") is never applied. Null when the
 * rule does not apply; otherwise the calls to send instead of applying: the
 * agree / decline chips, or nothing at all.
 */
function vetoNegatedAgree(intent, message, answer, labels, question) {
  if (intent !== 'agree_to_card' || !(0, _rules.negates)(message)) return null;
  const ask = askCall(answer, {
    agree_to_card: labels.agree_to_card,
    decline_card: labels.decline_card
  }, question);
  return ask ? [ask] : [];
}
function newTrace() {
  return {
    intent: '',
    source: 'kev',
    asked: false,
    wrote: false,
    decideMs: 0,
    writeMs: 0
  };
}

/** One decide() call, timed into the trace. */
async function timedDecide(trace, run) {
  const start = Date.now();
  try {
    return await run();
  } finally {
    trace.decideMs += Date.now() - start;
  }
}

/**
 * The built-in model's writing for this turn, or null when it refused, failed
 * or returned nothing usable. The caller then sends its fixed reply: the user
 * never sees an error from this step.
 */
async function write(ports, trace, call) {
  const start = Date.now();
  try {
    const prompt = (0, _shared.renderPrompt)(call.context, call.history, await ports.budget(call.system, call.schema));
    const value = await ports.write(call.system, prompt, call.schema);
    if (!value || typeof value !== 'object') return null;
    trace.wrote = true;
    return value;
  } catch {
    return null;
  } finally {
    trace.writeMs += Date.now() - start;
  }
}

/** The writer's reply text, or the fixed reply. */
function replyOr(value, fallback) {
  const reply = typeof value?.reply === 'string' ? value.reply.trim() : '';
  return reply || fallback;
}

/** The decision block for the writer's prompt. */
function decisionBlock(lines) {
  return `How Mera read the message:\n${lines}`;
}