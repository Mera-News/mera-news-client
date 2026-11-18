"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.applyShippedFilter = exports.S7_GATE = exports.NO_USABLE_SET_GATE = exports.EMPTY_CONTENT_GATE = void 0;
exports.countMatchedLadder = countMatchedLadder;
exports.filterCorrectness = filterCorrectness;
exports.integrityReport = integrityReport;
exports.nearDuplicateRate = nearDuplicateRate;
exports.s7Report = s7Report;
exports.sharedRules = sharedRules;
var _topicDedupe = require("../core/topic-dedupe");
var _topicSimilarity = require("../core/topic-similarity");
var _copyRules = require("./copy-rules");
// mera-harness/eval — topic-set scoring, shared by the topic-prompt
// comparison and the agent corpus. Pure.
//
// GATE ORDER IS LOAD-BEARING AND IT IS ENCODED HERE, not left to the caller's
// discretion. `scoreTopicRun` returns the gates in the order they must be read:
//
//   1. output integrity  - empty content / finish_reason
//   2. filter correctness - the place-name regression
//   3. near duplicates   - within the set, POST-FILTER (shipped)
//   4. everything else   - quality
//
// Because every quality number IMPROVES as output disappears. An arm that
// generated nothing has no duplicates, no em dashes, no over-long topics and a
// perfect near-duplicate rate. Reading it before integrity rewards the arm that failed
// hardest, and reading it before filter correctness rewards a filter that
// bought its pass by eating ladder rungs.

/**
 * The eval's OWN place vocabulary, for the eval's own check.
 *
 * Deliberately not core's `placeExclusionSet`. Gate 2 asks whether the shipped
 * filter damaged a ladder, and a check that borrows the filter's own notion of
 * a place name stops being independent of the thing it audits — it would go
 * quiet in exactly the case where the filter's definition is what is wrong.
 * Derived structurally from the fact's resolved chain, never from
 * capitalisation: this repo has already paid for that heuristic once, when it
 * stripped "Port" out of "Port of Rotterdam" and missed "Polish".
 */
function evalTokens(text, exclude) {
  const out = new Set();
  for (const w of (text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w && !exclude.has(w)) out.add(w);
  }
  return out;
}

/** Jaccard with an exclusion set. Core dropped its `exclude` parameter when the
 *  place exclusion was removed from the shipped filter, but gate 2 still needs
 *  to ask "are these identical ONCE place words are ignored?" to detect a lost
 *  ladder rung. Eval-owned, for an eval-owned question. */
function evalJaccard(a, b, exclude) {
  const ta = evalTokens(a, exclude);
  const tb = evalTokens(b, exclude);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}
function evalPlaceWords(place) {
  const out = new Set();
  if (!place) return out;
  for (const field of [place.neighbourhood, place.locality, place.admin1, place.countryName]) {
    if (!field) continue;
    for (const word of field.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (word) out.add(word);
  }
  return out;
}
// ---------------------------------------------------------------------------
// Gate 1: output integrity
// ---------------------------------------------------------------------------

const EMPTY_CONTENT_GATE = exports.EMPTY_CONTENT_GATE = 0.02;

/**
 * GATE 1b, PRE-REGISTERED FOR THE RE-RUN: no usable topic set, at or below 5%.
 *
 * Promoted from a reported number to a gate because the original wording
 * proved to be the wrong instrument: it asked for EMPTY CONTENT and read 0.0%
 * on an arm that produced no usable set on 42% of calls, the model having
 * written reasoning prose where the contract wants a bare JSON array. Empty
 * and unusable are the same outcome downstream.
 *
 * 5% rather than the 2% of the empty-content gate: this one counts a
 * strictly larger class of failure, and the number is fixed here BEFORE the
 * re-run rather than chosen once its table is visible.
 */
const NO_USABLE_SET_GATE = exports.NO_USABLE_SET_GATE = 0.05;
function integrityReport(sets) {
  const finishReasons = {};
  let emptyContent = 0;
  let unparsedOutput = 0;
  for (const s of sets) {
    finishReasons[s.finishReason] = (finishReasons[s.finishReason] ?? 0) + 1;
    const blank = s.rawOutput.trim().length === 0;
    if (blank) emptyContent += 1;else if (s.topics.length === 0) unparsedOutput += 1;
  }
  const n = sets.length;
  const emptyRate = n === 0 ? 0 : emptyContent / n;
  const unparsedRate = n === 0 ? 0 : unparsedOutput / n;
  return {
    calls: n,
    emptyContent,
    emptyRate,
    unparsedOutput,
    unparsedRate,
    noUsableSetRate: emptyRate + unparsedRate,
    finishReasons,
    passed: emptyRate <= EMPTY_CONTENT_GATE,
    passedOnUsableSets: emptyRate + unparsedRate <= NO_USABLE_SET_GATE
  };
}

// ---------------------------------------------------------------------------
// Gate 2: filter correctness
// ---------------------------------------------------------------------------

/** The shipped filter, re-exported rather than reimplemented. An eval that carries
 *  its own copy of the rule it is measuring stops measuring the shipped one
 *  the first time either side is edited. */

const applyShippedFilter = exports.applyShippedFilter = _topicDedupe.filterNearDuplicates;
function filterCorrectness(topics, placeChain) {
  const withExclusion = applyShippedFilter(topics);
  const placeWords = evalPlaceWords(placeChain);
  const droppedOnPlaceNameAlone = withExclusion.dropped.filter(d => d.overlap.length > 0 && d.overlap.every(w => placeWords.has(w)));

  // Identical ONLY once place words are removed: the two topics are distinct
  // rungs of one ladder and the filter could not tell them apart.
  const droppedDifferingOnlyByPlace = withExclusion.dropped.filter(d => evalJaccard(d.topic, d.duplicateOf, placeWords) === 1 && evalJaccard(d.topic, d.duplicateOf, new Set()) < 1);
  return {
    dropped: withExclusion.dropped.length,
    droppedOnPlaceNameAlone,
    droppedDifferingOnlyByPlace,
    passed: droppedOnPlaceNameAlone.length === 0 && droppedDifferingOnlyByPlace.length === 0
  };
}

// ---------------------------------------------------------------------------
// Gate 3: within-set near duplicates
// ---------------------------------------------------------------------------

const S7_GATE = exports.S7_GATE = 0.1;

/** Fraction of topics that near-duplicate an EARLIER topic in the same set. */
function nearDuplicateRate(topics) {
  let flagged = 0;
  for (let i = 0; i < topics.length; i++) {
    for (let j = 0; j < i; j++) {
      if ((0, _topicSimilarity.contentJaccard)(topics[i], topics[j]) >= _topicSimilarity.DETECT_JACCARD || (0, _topicSimilarity.isSubsetTopic)(topics[i], topics[j]) || (0, _topicSimilarity.isSubsetTopic)(topics[j], topics[i])) {
        flagged += 1;
        break;
      }
    }
  }
  return {
    rate: topics.length === 0 ? 0 : flagged / topics.length,
    flagged
  };
}
function s7Report(set) {
  // The detector judges two topics the way a READER sees them, and a place
  // name is content to a reader. Core dropped its exclusion entirely, so the
  // two now agree on tokens and differ only where they are meant to: the
  // filter at 0.75 with no subset rule, the detector at 0.6 or on a subset.
  const raw = nearDuplicateRate(set.topics);
  const kept = applyShippedFilter(set.topics).kept;
  const post = nearDuplicateRate(kept);
  return {
    postFilterRate: post.rate,
    postFilterFlagged: post.flagged,
    rawRate: raw.rate,
    rawFlagged: raw.flagged,
    topics: set.topics.length,
    requestedCount: set.topics.length
  };
}

// ---------------------------------------------------------------------------
// Gate 4: the shared quality rules
// ---------------------------------------------------------------------------

function norm(s) {
  return s.trim().toLowerCase();
}
function sharedRules(set) {
  const existing = new Set(set.existingTopics.map(norm));
  const declined = new Set(set.declinedTopics.map(norm));
  return {
    topics: set.topics.length,
    duplicatesOfExisting: set.topics.filter(t => existing.has(norm(t))),
    duplicatesOfDeclined: set.topics.filter(t => declined.has(norm(t))),
    wordCountViolations: set.topics.filter(t => !(0, _copyRules.topicWordCountOk)(t)),
    bannedDash: set.topics.filter(t => (0, _copyRules.hasBannedDash)(t))
  };
}

// ---------------------------------------------------------------------------
// Count-matched ladder comparison
// ---------------------------------------------------------------------------

/**
 * Score the ladder on cells where EVERY compared arm returned a set.
 *
 * WHY, AND IT IS NOT A DETAIL. Scoring each arm over whatever it happened to
 * produce gives the arms different denominators, and an arm that fails to
 * return a set on half its calls is then judged on the half it managed. Step A
 * round 1: the skill arm scored 33 rung-slots against one-shot's 63, so its
 * 75.8% was measured over a remnant roughly half the size and was not
 * comparable to the control's 88.9% at all.
 *
 * The dropout is itself a finding, which is what gate 1b is for. It must not
 * ALSO be allowed to flatter the quality number, so the unmatched count is
 * returned and the caller prints it beside the comparison.
 */

function countMatchedLadder(entries, scoreOne) {
  const arms = [...new Set(entries.map(e => e.arm))];
  const byKey = new Map();
  for (const e of entries) {
    const m = byKey.get(e.key) ?? new Map();
    m.set(e.arm, e.set);
    byKey.set(e.key, m);
  }
  const perArm = {};
  for (const a of arms) {
    perArm[a] = {
      rungsCovered: 0,
      rungsTotal: 0,
      fieldGenericPresent: 0,
      fieldGenericCases: 0,
      topicsTotal: 0,
      cells: 0,
      perCellCounts: []
    };
  }
  const droppedByArm = {};
  let matchedCells = 0;
  let unmatchedCells = 0;
  for (const [, m] of byKey) {
    const missing = arms.filter(a => (m.get(a)?.topics.length ?? 0) === 0);
    if (missing.length > 0) {
      unmatchedCells += 1;
      for (const a of missing) droppedByArm[a] = (droppedByArm[a] ?? 0) + 1;
      continue;
    }
    matchedCells += 1;
    for (const a of arms) {
      const set = m.get(a);
      perArm[a].topicsTotal += set.topics.length;
      perArm[a].cells += 1;
      perArm[a].perCellCounts.push(set.topics.length);
      const scored = scoreOne(set);
      if (!scored) continue;
      perArm[a].rungsCovered += scored.rungsCovered;
      perArm[a].rungsTotal += scored.rungsTotal;
      if (scored.fieldGenericPresent !== null) {
        perArm[a].fieldGenericCases += 1;
        if (scored.fieldGenericPresent) perArm[a].fieldGenericPresent += 1;
      }
    }
  }
  return {
    matchedCells,
    unmatchedCells,
    droppedByArm,
    perArm
  };
}