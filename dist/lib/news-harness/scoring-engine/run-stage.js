"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.computeAndScore = computeAndScore;
var _ports = require("../core/ports");
var _scoring = require("../article-pipeline/scoring");
var _scoringDecode = require("../article-pipeline/scoring-decode");
var _relevance = require("./relevance");
var _suppression = require("./suppression");
var _locationRule = require("./location-rule");
// scoring-engine — the single stage BOTH scoring orchestrators route through.
// Structural "no divergence" guarantee: scoring-service.ts (sync) and
// scoring-pipeline.ts (E2EE async) both call computeAndScore, so the hard
// screen, the math and the legacy scoring can never drift between them.
//
//   0. HARD "not interested" screen (persona.hardSuppressions) — matching
//      candidates are dropped here and returned in `excludedIds`; they never
//      reach the math, the LLM score or the reason pass.
//  0b. LOCATION rule (persona.location, location-rule.ts) — a story from a
//      country none of its matched facts point at is scored 0, its components
//      marked `locationCaught`, and it reaches no model.
//   1. computeRelevance() per candidate (on-device math) → computed score +
//      components + mode. The math score is the FALLBACK that stands if the LLM
//      call fails, and it is what carries the SOFT suppression penalty.
//   2. EVERY active candidate → the legacy tiered LLM score call, which applies
//      its score to rawScoreMap minus the soft suppression penalty the math
//      already computed for the same candidate — otherwise a "shown less" filter
//      would be silently inert. Reasons stay the orchestrator's job (this stage
//      returns only scores).
//
// THE JUDGE IS GONE. Step 2 used to be split: tagged ("math"-mode) candidates
// went to a combined judge+reason call and kept their math score, untagged
// ("backstop") ones took the legacy LLM path. With the judge deleted there is
// one path, so every candidate takes it — including tagged ones, which is what
// made it safe to delete the `USE_ARTICLE_TAGS` blanking afterwards (there is
// no longer a judge for a tagged row to be routed onto).
//
// `mode` survives as a DIAGNOSTIC, not as routing: it is persisted inside
// `score_components_json` and counted by `getScoringModeBreakdown` for the
// Observability feed funnel.
//
// Pure except for the injected LlmPort. RN-free.

/** One candidate for the stage. `input` carries the rich metadata the math +
 *  math needs; `legacy` is the ScoringCandidate shape the tiered LLM prompt
 *  scores through (omit for math-only callers/eval). */

/** Scores every candidate in ONE call; returns app-scale relevance (0..1) per
 *  id. A missing id keeps the math score. Must not throw for a partial answer. */

/**
 * Hard-screen, compute the math for every candidate, then score them all
 * through the legacy tiered LLM call. Returns merged per-id maps.
 */
async function computeAndScore(candidates, persona, llm, config, opts = {}) {
  const logger = opts.logger ?? _ports.NOOP_LOGGER;
  const nowMs = opts.nowMs ?? Date.now();
  const eng = config.scoringEngine;
  const pipe = config.articlePipeline;
  const rawScoreMap = new Map();
  const computedScoreMap = new Map();
  const componentsMap = new Map();
  const modeMap = new Map();

  // --- 0. HARD "not interested" screen ---------------------------------------
  // Runs BEFORE any math so an excluded row costs no compute, no judge tokens
  // and no reason call. Absent/empty hardSuppressions ⇒ nothing is screened,
  // i.e. exactly the earlier behaviour.
  //
  // Top-headline rows that MATCH a hard filter are NOT excluded — they stay
  // in `active` and computeRelevance demotes them (one shared predicate,
  // suppression.ts::isHardFilterExempt). Logged separately so the split is
  // visible in the field.
  //
  // THIS IS THE SCREEN THE WHOLE "not interested" FEATURE RUNS ON, and it is on
  // the legacy path — it did not go anywhere when the judge did.
  const {
    excluded: excludedValueById,
    exempted: exemptedValueById
  } = (0, _suppression.screenHardSuppressionsDetailed)(candidates.map(c => c.input), persona.hardSuppressions);
  const excludedIds = new Set(excludedValueById.keys());
  const active = excludedIds.size > 0 ? candidates.filter(c => !excludedIds.has(c.input.id)) : candidates;
  if (excludedIds.size > 0) {
    logger.debug('[computeAndScore] hard filters excluded candidates', {
      excluded: excludedIds.size,
      of: candidates.length,
      values: [...new Set(excludedValueById.values())].slice(0, 10)
    });
  }
  if (exemptedValueById.size > 0) {
    logger.debug('[computeAndScore] hard filters demoted (not removed) headlines', {
      exempted: exemptedValueById.size,
      of: candidates.length,
      values: [...new Set(exemptedValueById.values())].slice(0, 10)
    });
  }

  // --- 0b. location rule: caught rows are scored 0 here and reach no model ---
  const locationCaughtIds = persona.location ? (0, _locationRule.screenLocationRule)(active, persona.location) : new Set();

  // --- 1. math for every active candidate ------------------------------------
  // No partition any more: with the judge gone there is nowhere else to send a
  // candidate, so `mode` is recorded for the Observability funnel and nothing
  // branches on it.
  for (const c of active) {
    const r = (0, _relevance.computeRelevance)(c.input, persona, eng, nowMs);
    const caught = locationCaughtIds.has(c.input.id);
    computedScoreMap.set(c.input.id, r.score);
    componentsMap.set(c.input.id, caught ? {
      ...r.components,
      locationCaught: true
    } : r.components);
    modeMap.set(c.input.id, r.mode);
    // fail-open default; the LLM overwrites. A caught row stays at 0.
    rawScoreMap.set(c.input.id, caught ? 0 : r.score);
  }

  // --- 2. score for EVERY active candidate ------------------------------------
  // `c.legacy` is the ScoringCandidate the tiered prompt needs; math-only
  // callers (the offline eval) omit it and get the math score untouched, which
  // is also what `skipLlm` buys.
  const scorable = opts.skipLlm ? [] : active.filter(c => c.legacy && !locationCaughtIds.has(c.input.id));

  // The LLM (or injected scorer) knows nothing about the user's filters, so its
  // score REPLACES the math score that carried them. Re-apply the SAME
  // penalties the math already computed for this candidate (components.*, via
  // the one kind-aware matcher in suppression.ts): no second matcher, no
  // second cap. Applied AT the overwrite site, never to a fail-open math score,
  // which already carries them (that would double-count). A candidate matching
  // nothing is written untouched, so the no-filter path stays byte-identical.
  let penalised = 0;
  const applyScore = (id, score) => {
    const comps = componentsMap.get(id);
    const penalty = comps?.suppressPenalty ?? 0;
    let next = score;
    if (penalty > 0) {
      penalised += 1;
      next = Math.max(0, next - penalty);
    }
    // ENTITY share: applied against ENTITY_PENALTY_FLOOR rather than subtracted
    // outright (entity extraction is 68.8% correct, so it may lower a rank but
    // never push a row out). Same helper `computeRelevance` uses.
    const entityPenalty = comps?.entityPenalty ?? 0;
    if (entityPenalty > 0) {
      if (penalty <= 0) penalised += 1;
      next = (0, _relevance.applyEntityPenalty)(next, entityPenalty, eng);
    }
    // DEMOTED, NEVER REMOVED: an exempt top headline carries a HARD
    // filter's penalty in `suppressPenalty`; floor it so it cannot vanish.
    if (comps?.hardFilterExempt) {
      next = Math.max(next, eng.HEADLINE_BASE_FLOOR);
    }
    rawScoreMap.set(id, next);
  };
  if (scorable.length > 0 && opts.relevanceScorer) {
    // Injected scorer (Kev on-device): ONE call with every scorable candidate,
    // no prompts, no batchComplete. It returns app-scale relevance (0..1). A
    // missing id gets NO score: it leaves rawScoreMap, so the caller leaves the
    // row unscored for the next pass (the Feed shows unscored rows). A math
    // score standing in for Kev put whole runs in the LOW band (owner, 2026-10-21).
    const scored = await opts.relevanceScorer(scorable.map(c => c.legacy), opts.factStatements ?? []);
    for (const c of scorable) {
      const score = scored.get(c.input.id);
      if (score !== undefined) applyScore(c.input.id, score);else rawScoreMap.delete(c.input.id);
    }
  } else if (scorable.length > 0) {
    const facts = opts.factStatements ?? [];
    const chunks = (0, _scoring.chunk)(scorable, pipe.articlesPerScorePrompt);
    const calls = chunks.map((chunkItems, idx) => {
      const legacy = chunkItems.map(c => c.legacy);
      // A chunk of top headlines only gets the headline prompt, as the gateway's pipeline sends.
      const {
        prompt,
        system
      } = (0, _scoring.buildScoreCallForChunk)(legacy, facts, (0, _scoring.relevanceSystemPromptFor)(pipe, (0, _scoring.resolveScoringVariant)(legacy)), pipe, undefined, opts.today);
      return {
        id: `score:${idx}`,
        system,
        prompt,
        temperature: pipe.scoreTemperature,
        maxTokens: pipe.scoreBatchMaxTokens
      };
    });
    const results = await llm.batchComplete(calls, {
      model: pipe.model
    });
    const resultById = new Map(results.map(r => [r.id, r]));
    chunks.forEach((chunkItems, idx) => {
      const result = resultById.get(`score:${idx}`);
      if (!result || result.error) {
        // Fail-open: leave the math score (already in rawScoreMap).
        return;
      }
      const scores = (0, _scoringDecode.parseBatchRelevanceResponse)(result.output, chunkItems.length, `score:${idx}`, undefined, pipe, logger);
      chunkItems.forEach((c, i) => applyScore(c.input.id, scores[i]));
    });
  }
  if (penalised > 0) {
    logger.debug('[computeAndScore] soft filters penalised candidates', {
      penalised,
      of: scorable.length
    });
  }
  return {
    rawScoreMap,
    computedScoreMap,
    componentsMap,
    modeMap,
    excludedIds,
    excludedValueById,
    exemptedValueById,
    locationCaughtIds
  };
}