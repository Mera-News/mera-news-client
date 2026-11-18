"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.choiceLine = choiceLine;
exports.confidenceWord = confidenceWord;
exports.formatDecision = formatDecision;
exports.intentLine = intentLine;
exports.relevanceLine = relevanceLine;
exports.targetFactLine = targetFactLine;
var _decision = require("./decision");
// Layer 3: Kev's decision as a few plain-English lines for the writer's
// prompt. Never JSON and never a model name: the built-in model echoes what it
// reads. One line per question, in a stable order, for example
//
//   What the user wants: remove a saved fact (very likely, 0.91)
//   The fact they mean: "Lives in Porto" (likely, 0.74)
//
// Pure and RN-free. The relevance line reads the score answer's own legend, so
// nothing here imports the relevance model's questions.

/** Above the default cap the block starts eating the writer's 4,000-token input. */
const DEFAULT_MAX_CHARS = 600;
/** One option description in a line; the criteria texts are authored short. */
const MAX_OPTION_CHARS = 120;

/** 'unsure' starts where Mera stops acting (UNSURE_MIN_CONFIDENCE), so a reading
 *  the writer is told to act on is never labelled unsure to it. */
function confidenceWord(p) {
  return p >= 0.8 ? 'very likely' : p >= _decision.UNSURE_MIN_CONFIDENCE ? 'likely' : 'unsure';
}
function clip(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 3).join('').trimEnd()}...`;
}
function fallbackText(key) {
  return key.replace(/_/g, ' ');
}
/** "Label: words (likely, 0.74)", plus ", or maybe: words (0.61)" when the runner-up is within 0.2. */
function choiceLine(label, answer, {
  describe = fallbackText,
  quote = false
} = {}, keyOrder) {
  const [first, second] = (0, _decision.ranked)(answer, keyOrder);
  if (!first) return `${label}: nothing decided`;
  const words = key => {
    const text = clip(describe(key), MAX_OPTION_CHARS);
    return (typeof quote === 'function' ? quote(key) : quote) ? `"${text}"` : text;
  };
  let line = `${label}: ${words(first.key)} (${confidenceWord(first.p)}, ${first.p.toFixed(2)})`;
  if (second && (0, _decision.margin)(answer) < _decision.UNSURE_MIN_MARGIN) {
    line += `, or maybe: ${words(second.key)} (${second.p.toFixed(2)})`;
  }
  return line;
}

/** Choice criteria as a describe function: the description, or the key in words when it is null. */
function criteriaWords(criteria) {
  return key => criteria[key] ?? fallbackText(key);
}

/** What the user wants, from the intent question. */
function intentLine(answer, criteria, label = 'What the user wants') {
  return choiceLine(label, answer, {
    describe: criteriaWords(criteria)
  }, Object.keys(criteria));
}

/** The saved fact they mean, quoted. `noneKey` (default 'none') reads as no saved fact. */
function targetFactLine(answer, criteria, {
  label = 'The fact they mean',
  noneKey = 'none'
} = {}) {
  const describe = criteriaWords(criteria);
  return choiceLine(label, answer, {
    describe: k => k === noneKey ? 'none of the saved facts' : describe(k),
    // A quoted "none" would read as a fact called none.
    quote: k => k !== noneKey
  }, Object.keys(criteria));
}

/** A score answer (the relevance question) as its likeliest level's words, from the answer's legend. */
function relevanceLine(answer, label = 'How relevant this is to them') {
  return choiceLine(label, {
    probabilities: answer.probabilities
  }, {
    describe: level => answer.legend[level] ?? `level ${level}`
  }, Object.keys(answer.legend));
}
function noulLine(label, answer, criteria) {
  const yes = answer.noul >= 0.5;
  return choiceLine(label, {
    probabilities: {
      true: answer.noul,
      false: 1 - answer.noul
    },
    choice: yes ? 'true' : 'false'
  }, {
    describe: k => k === 'true' ? criteria?.true ?? 'yes' : criteria?.false ?? 'no'
  }, ['true', 'false']);
}
function lineFor(id, question, answer, opts) {
  const label = opts.labels?.[id] ?? fallbackText(id);
  if (question.type === 'choice' && answer.type === 'choice') {
    return choiceLine(label, answer, {
      describe: criteriaWords(question.criteria),
      quote: opts.quote?.includes(id)
    }, Object.keys(question.criteria));
  }
  if (question.type === 'score' && answer.type === 'score') return relevanceLine(answer, label);
  if (question.type === 'noul' && answer.type === 'noul') return noulLine(label, answer, question.criteria);
  return null;
}

/**
 * The whole decision as one block. Questions with no answer are skipped. Over
 * `maxChars`, extra lines go first, then decision lines from the end; a line
 * that alone is over the cap is cut and ends in "...".
 */
function formatDecision(questions, answers, opts = {}) {
  const ids = opts.order ?? Object.keys(questions);
  const lines = [];
  for (const id of ids) {
    const question = questions[id];
    const answer = answers[id];
    if (!question || !answer) continue;
    const line = lineFor(id, question, answer, opts);
    if (line) lines.push(line);
  }
  const max = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const all = [...lines, ...(opts.extra ?? [])];
  while (all.length > 1 && all.join('\n').length > max) all.pop();
  return all.length === 1 ? clip(all[0], max) : all.join('\n');
}