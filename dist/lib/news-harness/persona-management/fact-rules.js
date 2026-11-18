"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MAX_FACT_LENGTH = exports.MAX_FACT_CHOICE_OPTIONS = void 0;
exports.filterFactChoiceGroups = filterFactChoiceGroups;
exports.filterNewFacts = filterNewFacts;
exports.normalizeFactEntry = normalizeFactEntry;
exports.normalizeStatement = void 0;
var _normalizeKey = require("../../algorithms/normalize-key");
// news-harness — pure fact-acceptance rules.
//
// Extracted from lib/chat-tools/tool-handlers.ts::handleSaveExtractedFacts. The
// accept/reject DECISIONS live here as a pure function; the handler keeps the DB
// writes, store notify, and topic-generation trigger and delegates the decisions
// to filterNewFacts.

const MAX_FACT_LENGTH = exports.MAX_FACT_LENGTH = 200;

/** A fact entry from the LLM — either a plain string (legacy) or an object with
 *  questionnaire metadata. */

/** `level`/`levelCategory` are DEAD: the legacy level-based questionnaire is
 *  gone, so `normalizeFactEntry` can never populate them again. They stay on
 *  this type because two consumers still READ them off the object —
 *  lib/database/services/fact-service.ts::addFact and
 *  lib/database/models/Fact.ts::createFact — which were deliberately left
 *  untouched so the `facts` table's (now never-written) `questionnaire_level`
 *  columns keep compiling. Remove those two reads first if you delete these. */

function normalizeFactEntry(entry) {
  if (typeof entry === 'string') {
    return {
      statement: entry
    };
  }
  return {
    statement: entry.statement ?? '',
    questionnaire: entry.questionnaire_attribute ? {
      attribute: entry.questionnaire_attribute
    } : undefined,
    alternatives: Array.isArray(entry.alternatives) ? entry.alternatives.filter(a => typeof a === 'string') : undefined,
    // Carried through verbatim. Whether it is HONOURED is decided later, at
    // commit time, against a confirmed choice -- see fact-commit.
    replaces: typeof entry.replaces === 'string' && entry.replaces.trim().length > 0 ? entry.replaces.trim() : undefined,
    topicSkillId: typeof entry.topic_skill_id === 'string' && entry.topic_skill_id.trim().length > 0 ? entry.topic_skill_id.trim() : undefined
  };
}

/** Canonicalizes a statement for duplicate detection (lowercase, single-spaced). */
const normalizeStatement = exports.normalizeStatement = _normalizeKey.normalizeKey;

/** Meta-conversational statements the LLM sometimes hallucinates as facts. */
const META_CONVERSATIONAL_PATTERNS = [/^user\s+(is|wants?|asked?|greeted|said|requested)\b/, /\b(setting up|update|updating|set up)\s+(persona|profile|preferences)\b/];
/**
 * Applies the exact accept/reject rules the old handler applied inline, in order:
 *   empty → too-long (>200) → meta-conversational → duplicate (vs existing).
 *
 * `existingStatements` may be raw or already normalized: BOTH sides of the
 * duplicate check run through `normalizeStatement`, so the caller carries no
 * precondition. Duplicate detection is against `existingStatements` only — like
 * the original, facts accepted earlier in the same batch do NOT dedup against
 * each other.
 */
function filterNewFacts(entries, existingStatements) {
  // Normalized on INSERT as well as on lookup. Keying this set on whatever the
  // caller happened to pass while probing it with a normalized key meant dedup
  // worked ONLY for a caller that had already normalized. The one production
  // caller does (tool-handlers), so the app was correct and the function was
  // silently broken for everyone else: raw "Lives in Rotterdam, Netherlands"
  // against an identical incoming statement was ACCEPTED as new.
  // `normalizeStatement` is idempotent, so an already-normalized caller is
  // unaffected and this changes no shipped behaviour.
  const existing = new Set();
  for (const s of existingStatements) existing.add(normalizeStatement(s));
  const accepted = [];
  const rejected = [];
  for (const factEntry of entries) {
    const {
      statement,
      questionnaire
    } = normalizeFactEntry(factEntry);
    const trimmed = statement.trim();
    if (!trimmed) {
      rejected.push({
        statement: trimmed,
        reason: 'empty'
      });
      continue;
    }
    if (trimmed.length > MAX_FACT_LENGTH) {
      rejected.push({
        statement: trimmed,
        reason: 'too-long'
      });
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (META_CONVERSATIONAL_PATTERNS.some(re => re.test(lower))) {
      rejected.push({
        statement: trimmed,
        reason: 'meta'
      });
      continue;
    }
    if (existing.has(normalizeStatement(trimmed))) {
      rejected.push({
        statement: trimmed,
        reason: 'duplicate'
      });
      continue;
    }
    accepted.push({
      statement: trimmed,
      questionnaire
    });
  }
  return {
    accepted,
    rejected
  };
}

// ---------------------------------------------------------------------------
// Fact CHOICE groups — propose-before-save
// ---------------------------------------------------------------------------

/** How many readings one card may offer. The user asked for as few as possible:
 *  one when the input is unambiguous, never more than this. */
const MAX_FACT_CHOICE_OPTIONS = exports.MAX_FACT_CHOICE_OPTIONS = 4;

/**
 * One fact Mera is OFFERING, with the readings it is offering for it.
 *
 * `options[0]` is the model's preferred reading. A group with one option is the
 * unambiguous case and is still a group — the user still taps, which is what
 * makes the tap mean "save this" rather than "stop showing me this".
 */

/**
 * Turns the tool's `extracted_user_information` array into offerable groups.
 *
 * ONE ARRAY ELEMENT = ONE FACT = ONE GROUP, and its readings live on the
 * element. That is what keeps "several distinct facts in one turn" and "several
 * readings of one fact" from competing: N facts give N independent cards, so
 * nothing has to be squeezed through a single proposal-level flag.
 *
 * Every option runs the SAME accept/reject rules a saved fact used to run
 * (`filterNewFacts`), so a duplicate or over-long reading is dropped from the
 * card rather than offered and then refused after the tap. A group whose every
 * option is rejected yields no group at all — there is nothing to ask about.
 */
function filterFactChoiceGroups(entries, existingStatements) {
  const groups = [];
  const rejected = [];
  for (const entry of entries) {
    const {
      statement,
      questionnaire,
      alternatives,
      replaces,
      topicSkillId
    } = normalizeFactEntry(entry);
    // Preferred reading first, then alternatives, deduped against each other so
    // a model that repeats itself does not render the same row twice.
    const candidates = [statement, ...(alternatives ?? [])];
    const seen = new Set();
    const unique = [];
    for (const c of candidates) {
      const key = normalizeStatement(c ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(c);
    }
    const {
      accepted,
      rejected: groupRejected
    } = filterNewFacts(unique, existingStatements);
    rejected.push(...groupRejected);
    if (accepted.length === 0) continue;
    groups.push({
      options: accepted.slice(0, MAX_FACT_CHOICE_OPTIONS).map(a => a.statement),
      // The attribute belongs to the FACT, not to a reading of it, so it is
      // taken from the entry rather than from whichever option survived.
      // It must reach `addFact`: resolveUserLocationFact keys on it, and a
      // residence fact that loses it stops anchoring every future topic run.
      questionnaire,
      ...(replaces ? {
        replaces
      } : {}),
      ...(topicSkillId ? {
        topicSkillId
      } : {})
    });
  }
  return {
    groups,
    rejected
  };
}