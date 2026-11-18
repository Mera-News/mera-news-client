"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.findSimilarFacts = findSimilarFacts;
var _index = _interopRequireDefault(require("../index"));
var _factRules = require("../../news-harness/persona-management/fact-rules");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Find facts on this device that look like a candidate statement.
//
// This RANKS; it does not judge. There is no score floor: a floor bakes a
// relevance decision into a number the caller cannot see, and makes "nothing
// was similar" indistinguishable from "something scored just under the line".
// The top N come back with their scores and the caller decides.

const factsCollection = _index.default.get('facts');
const DEFAULT_LIMIT = 5;

/** Same-kind candidates edge ahead of cross-kind ones at equal overlap. */
const SAME_KIND_BONUS = 0.1;

/**
 * Words carrying no identifying signal. Kept deliberately short: an aggressive
 * list would strip the content words of short statements ("I live in Rome"
 * is mostly stopwords) and collapse unrelated facts onto the same token set.
 */
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'with', 'my', 'i', 'user']);
function contentTokens(statement) {
  return new Set((0, _factRules.normalizeStatement)(statement).split(/[^a-z0-9]+/).filter(t => t.length > 0 && !STOPWORDS.has(t)));
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Facts that look like `statement`, best first.
 *
 * `kind` is the questionnaire ATTRIBUTE (`facts.questionnaire_attribute`) —
 * the only notion of kind the facts table actually stores. Pass null when
 * unknown. It is NOT a hard filter: the duplicate worth finding is often the
 * one saved under a different attribute, so same-kind candidates are ranked
 * up rather than being the only ones considered.
 *
 * Normalisation is `normalizeStatement` from the harness's fact-rules, the
 * same function `filterNewFacts` dedups on — so a score of 1 means
 * "filterNewFacts would reject this statement as a duplicate", which is the
 * property that makes this answer actionable rather than advisory.
 *
 * One unfiltered query: facts number in the tens on a real device, and no
 * index helps token overlap, so filtering by kind in SQL would be a false
 * economy for the same reason kind is not a hard filter.
 */
async function findSimilarFacts(kind, statement, limit = DEFAULT_LIMIT) {
  const needle = contentTokens(statement);
  if (needle.size === 0 || limit <= 0) return [];
  const records = await factsCollection.query().fetch();
  const scored = records.map(r => {
    const sameKind = !!kind && r.questionnaireAttribute === kind;
    const base = jaccard(needle, contentTokens(r.statement));
    return {
      id: r.id,
      statement: r.statement,
      questionnaireAttribute: r.questionnaireAttribute ?? null,
      score: Math.min(1, base + (sameKind ? SAME_KIND_BONUS : 0)),
      sameKind
    };
  });

  // Score descending; same-kind breaks an exact tie so the ordering is
  // deterministic rather than dependent on row order.
  scored.sort((a, b) => b.score - a.score || Number(b.sameKind) - Number(a.sameKind));
  return scored.slice(0, limit);
}