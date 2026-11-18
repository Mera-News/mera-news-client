"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.UNSURE_MIN_MARGIN = exports.UNSURE_MIN_CONFIDENCE = void 0;
exports.isUnsure = isUnsure;
exports.margin = margin;
exports.ranked = ranked;
exports.runDecision = runDecision;
exports.top = top;
// Layer 1 of "Kev decides, the built-in model writes": a flow's typed
// question to Kev, run as ONE decide() call, plus the readers every flow shares.
// Pure and RN-free: the app passes the toolkit's decide() (llama lock inside),
// the harness passes a local Kev. Type imports from llama.rn are erased at
// runtime.

/** One decide() call. App: toolkit `decide` (takes the llama lock, not
 *  re-entrant, so never call it from inside withLlamaLock). Harness: local Kev. */

/** The built-in model writing a reply to a schema. Resolves to the parsed object;
 *  a refusal or a parse failure rejects, and the flow falls back to a fixed reply. */

/**
 * A flow's decision. `questions` holds 1-2 questions, and a choice question
 * lists an option only when it applies (agree_to_card only with a card
 * pending). Each question is a full read of the state, about 0.6 s on the
 * phone, and each must stay under 4,096 prompt tokens.
 * Choice keys that look like numbers sort first: prefix them ('f1', not '1').
 */

/** Exactly one decide() call. A follow-up (the target fact) is a second spec,
 *  run only when the first decision needs it. */
async function runDecision(spec, input, decide) {
  const questions = spec.questions(input);
  const result = await decide({
    state: spec.state(input),
    questions
  });
  const answers = result.answers;
  return {
    decision: spec.read(answers, input),
    questions,
    answers
  };
}

/**
 * Below this top probability Mera asks instead of acting. The first values were 0.6
 * and 0.2; these were set on the dev split (ask rate and accuracy both improved). Kev answers
 * at its GGUF temperature (2.4), so its probabilities are soft: over 5 to 7 options a
 * clear reading often tops out near 0.5.
 */
const UNSURE_MIN_CONFIDENCE = exports.UNSURE_MIN_CONFIDENCE = 0.4;
/** A top-2 gap below this is a close call, so Mera asks. */
const UNSURE_MIN_MARGIN = exports.UNSURE_MIN_MARGIN = 0.15;
/**
 * Options by probability, highest first. `probabilities` has no guaranteed key
 * order, so a tie goes to the order of `keyOrder` (pass the question's criteria
 * keys), then to the key Kev chose, then to plain key order.
 */
function ranked(answer, keyOrder) {
  const order = Array.isArray(keyOrder) ? keyOrder : keyOrder ? Object.keys(keyOrder) : [];
  const pos = k => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };
  return Object.entries(answer.probabilities).map(([key, p]) => ({
    key,
    p
  })).sort((a, b) => b.p - a.p || pos(a.key) - pos(b.key) || (a.key === answer.choice ? -1 : b.key === answer.choice ? 1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The likeliest option, or null for an answer with no options. */
function top(answer, keyOrder) {
  return ranked(answer, keyOrder)[0] ?? null;
}

/** Top probability minus the runner-up's. A lone option has margin = its own p.
 *  Rounded to 1e-9 so 0.6 - 0.4 reads as 0.2, not 0.19999999999999996. */
function margin(answer) {
  const [first, second] = ranked(answer);
  return first ? Math.round((first.p - (second?.p ?? 0)) * 1e9) / 1e9 : 0;
}

/**
 * "Unsure": the top option's probability is under `minConfidence`, or its
 * lead over the runner-up is under `minMargin`. Read from the probabilities,
 * NOT from Kev's `confidence` field: that one is a spread measure (0 = all
 * options equally likely, 1 = one option has all the mass), so with many
 * options it stays low even when one option clearly leads.
 */
function isUnsure(answer, {
  minConfidence = UNSURE_MIN_CONFIDENCE,
  minMargin = UNSURE_MIN_MARGIN
} = {}) {
  const first = top(answer);
  if (!first) return true;
  return first.p < minConfidence || margin(answer) < minMargin;
}