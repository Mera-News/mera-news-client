"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "ASK_CHOICE_TOOL", {
  enumerable: true,
  get: function () {
    return _toolContracts.ASK_CHOICE_TOOL;
  }
});
Object.defineProperty(exports, "CONTINUATION_TOOLS", {
  enumerable: true,
  get: function () {
    return _toolContracts.CONTINUATION_TOOLS;
  }
});
exports.FACT_KINDS = void 0;
Object.defineProperty(exports, "FIND_SIMILAR_FACTS_TOOL", {
  enumerable: true,
  get: function () {
    return _toolContracts.FIND_SIMILAR_FACTS_TOOL;
  }
});
Object.defineProperty(exports, "HARNESS_TOOLS", {
  enumerable: true,
  get: function () {
    return _toolContracts.HARNESS_TOOLS;
  }
});
Object.defineProperty(exports, "LOAD_SKILL_TOOL", {
  enumerable: true,
  get: function () {
    return _toolContracts.LOAD_SKILL_TOOL;
  }
});
Object.defineProperty(exports, "LOOKUP_PLACE_TOOL", {
  enumerable: true,
  get: function () {
    return _toolContracts.LOOKUP_PLACE_TOOL;
  }
});
Object.defineProperty(exports, "MAX_CHOICE_OPTIONS", {
  enumerable: true,
  get: function () {
    return _toolContracts.MAX_CHOICE_OPTIONS;
  }
});
Object.defineProperty(exports, "MIN_CHOICE_OPTIONS", {
  enumerable: true,
  get: function () {
    return _toolContracts.MIN_CHOICE_OPTIONS;
  }
});
exports.NO_ROUTE_KIND = void 0;
Object.defineProperty(exports, "createAgentTurnState", {
  enumerable: true,
  get: function () {
    return _types.createAgentTurnState;
  }
});
exports.expectedTopicSkillFor = expectedTopicSkillFor;
exports.routeKindForSkill = routeKindForSkill;
exports.routeKindsFor = routeKindsFor;
Object.defineProperty(exports, "validateChoiceOptions", {
  enumerable: true,
  get: function () {
    return _toolContracts.validateChoiceOptions;
  }
});
var _types = require("../core/types");
var _toolContracts = require("../core/tool-contracts");
// mera-harness/eval — the tool contract, RE-EXPORTED from core.
//
// This file used to declare its own copy of every shape while
// lib/mera-harness/core did not exist yet, and its header promised to collapse
// into a re-export the moment it did. It has, so it did.
//
// WHY A RE-EXPORT AND NOT A SECOND DECLARATION. Three documents once carried three
// spellings of the same result field, which is the divergence a review
// caught. A mirrored type is that bug with extra steps: it typechecks
// against itself, drifts silently, and only fails when a real call disagrees
// with it at run time. core/types.ts is the contract; the eval consumes it.
//
// TWO HARD RULES FOR EVERYTHING UNDER lib/mera-harness/eval:
//
//  1. NO NODE BUILTINS in non-test source. `lib/` is inside the app's tsconfig
//     include (only `harness-local` and `eval/` at the repo root are
//     excluded) and that config sets no `types`, so `node:fs` would not
//     typecheck. Reading fixtures and hashing prompts belong to the CLI.
//  2. NO NETWORK, NO REACT, AND NEVER AN IMPORT FROM harness-local. The
//     dependency runs one way; __tests__/boundary.test.ts enforces it.

/**
 * The fact kinds the topic guidelines are keyed on.
 *
 * EVAL-ONLY, and deliberately so: core keys its skills by id
 * (`topics/residence`), while the eval corpus keys a FACT by kind to pick the
 * guideline it should have selected. Deriving one from the other here would
 * mean the eval asserting a mapping it also owns, which is a tautology rather
 * than a check.
 */
const FACT_KINDS = exports.FACT_KINDS = ['residence', 'origin', 'profession', 'family', 'interest', 'generic'];
/** The topic skill a fact kind should select. Asserted against the id the
 *  agent actually loaded, never used to produce it. */
function expectedTopicSkillFor(kind) {
  return `topics/${kind}`;
}

/**
 * The route kind the core derives from a loaded skill id.
 *
 * MIRRORS `routeKindFromSkill` in core/core.ts, which is module-private. Kept
 * in step with it by `contract.test.ts`, which drives the real loop and
 * compares. The rule: the LEAF of the id, with `generic` and an id carrying no
 * slash both meaning "no kind".
 *
 * A fixture says `"none"` where the core returns null, because a JSON fixture
 * cannot carry the distinction between absent and null usefully and a silent
 * mismatch there would score every generic turn as wrong.
 */
const NO_ROUTE_KIND = exports.NO_ROUTE_KIND = 'none';
function routeKindForSkill(skillId) {
  const slash = skillId.indexOf('/');
  if (slash === -1) return NO_ROUTE_KIND;
  const leaf = skillId.slice(slash + 1);
  return leaf && leaf !== 'generic' ? leaf : NO_ROUTE_KIND;
}

/** Every route kind a fixture may name, derived from the skill library rather
 *  than listed: a hand-written list drifts the moment a subject is added. */
function routeKindsFor(skillIds) {
  return [...new Set(skillIds.map(routeKindForSkill))];
}