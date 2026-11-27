"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DEFAULT_HARNESS_CONFIG = void 0;
var _prompts = require("../prompts/prompts");
// news-harness — configuration.
//
// The literals below are the EXACT current production values, previously spread
// as module constants across scoring-service.ts, inference-results.ts,
// topic-generation-service.ts, tool-handlers.ts, and feed-sync-steps.ts. They
// are gathered here so the harness has a single injectable config surface while
// behaviour stays bit-identical. See config.test.ts, which pins every literal.

/** The model of SCORING_MODELS[0] (lib/llm/profiles), as a literal: kept out of the harness
 *  import graph on purpose so the harness stays RN-free. The eval runners read it; the app
 *  ignores it: its scoring port routes by lane (lib/mera-protocol/stage-scoring). */
const SCORING_HEAD_MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';

/**
 * Deterministic math-relevance engine constants (— `scoring-engine/`).
 *
 * Property names use the scoring design's UPPER_SNAKE identifiers verbatim (W_*, P_*,
 * HP_MULT, POP_SAT, HEADLINE_*) so the config surface reads 1:1 against
 * the scoring design. Every value is a SEED to be tuned against
 * `eval:golden`; config.test.ts pins each literal so drift fails loudly. These
 * do NOT touch the tier/bucket cutoffs in `articlePipeline` — the engine emits a
 * raw score into the same 0.05–1.10 band the existing buckets/eval consume.
 */

/**
 * Bounded persona-mutation rails. The signal → weight-delta
 * budgets that gate every on-device persona nudge. HP_MULT is NOT here — it
 * already lives in `scoringEngine` (1.25); the rails reference it, never
 * duplicate it. Every value is a SEED; config.test.ts pins each literal so
 * drift fails loudly.
 */

const DEFAULT_HARNESS_CONFIG = exports.DEFAULT_HARNESS_CONFIG = {
  articlePipeline: {
    articlesPerScorePrompt: 5,
    // 5 articles × {"k":"…","s":0.xx} objects + array overhead. The tiered
    // relevance output (stake tag + score, decoder-clamped per band) needs
    // ~4× the budget of the old bare-numbers array; 320 leaves headroom so a
    // verbose model never truncates mid-array (truncation = whole batch falls
    // back to fallbackRelevance).
    scoreBatchMaxTokens: 320,
    v3NoteMaxTokens: 96,
    scoreTemperature: 0.1,
    reasonTemperature: 0.2,
    reasonMaxTokens: 96,
    discardFloor: 0.4,
    fallbackRelevance: 0.3,
    ineligibleRelevance: 0.2,
    // Lockstep with RENDER_GATE / inference-results.REASON_RELEVANCE_THRESHOLD
    // (0.3 -> 0.4 in v3 scoring); comparisons are INCLUSIVE (>=).
    reasonRelevanceThreshold: 0.4,
    // OFF by default — an explicit literal, not an absent key read as falsy, in
    // the same style and for the same reason as the scoringEngine routing
    // switches: the harness default must always describe SHIPPED behaviour, and
    // the owner flips it once he has seen it work. See the field's doc comment
    // for the paired measurement AND for the pre-registered bar it missed.
    legacyNoteDemote: false,
    // RELEVANCE v4 — both article-tag features on the legacy path, OFF by
    // default, as explicit literals rather than absent keys read as falsy —
    // same style and same reason as `legacyNoteDemote` above and the
    // scoringEngine routing switches: the harness default must always describe
    // SHIPPED behaviour. Each field's doc comment carries its own paired
    // measurement. v4 is controlled only here, currently off: to turn it on,
    // flip BOTH to `true` by an OTA (and update config.test.ts).
    legacyTagPromptEnabled: false,
    legacyTagReasonGateEnabled: false,
    // The measured set. Frozen as a literal so `config.test.ts` pins it and a
    // change has to be deliberate; see the field's TWO caveats before editing —
    // it is per-persona, and part of its value comes from a tagger mis-label.
    legacyTagReasonGateEventTypes: ['crime', 'other'],
    mediumPriorityCutoff: 0.6,
    highPriorityCutoff: 0.8,
    emergencyPriorityCutoff: 1.0,
    lowPriorityScore: 0.4,
    mediumPriorityScore: 0.6,
    highPriorityScore: 0.8,
    emergencyPriorityScore: 1.1,
    limitPerTopic: 20,
    hydrateChunkSize: 25,
    relevanceSystemPrompt: _prompts.CLOUD_RELEVANCE_SYSTEM_PROMPT,
    reasonSystemPrompt: _prompts.CLOUD_REASON_SYSTEM_PROMPT,
    v3NoteSystemPrompt: _prompts.CLOUD_V3_NOTE_SYSTEM_PROMPT,
    model: SCORING_HEAD_MODEL,
    // The verifier was absorbed into the judge; flag-off one release then
    // deleted (its NO-patterns live in CLOUD_JUDGE_SYSTEM_PROMPT). Code stays.
    feedVerifierEnabled: false,
    feedVerifierBatchSize: 15,
    feedVerifierDemoteScore: 0.28,
    feedVerifierMaxTokens: 260,
    // 15*12 + 80
    feedVerifierSystemPrompt: _prompts.CLOUD_FEED_VERIFIER_SYSTEM_PROMPT,
    // Headline calls carry articlesPerScorePrompt (5) articles, like every
    // call. They used to carry 3 (5 x 4454/7105, holding the longer rubric's
    // per-article attention; its failure mode is hedged over-inclusion), which
    // forced a separate headline queue. Dropped 2026-10-02 by owner decision to
    // queue headlines like any topic; the quality effect of 5 is unmeasured, so
    // a hedged-over-inclusion report on headlines points here first.
    // N=5 headline call: 7105 + 5x370 = 8955 est tokens in (no ceiling; logged).
    headlineRelevanceSystemPrompt: _prompts.CLOUD_HEADLINE_RELEVANCE_SYSTEM_PROMPT,
    headlineReasonSystemPrompt: _prompts.CLOUD_HEADLINE_REASON_SYSTEM_PROMPT
  },
  topicGen: {
    // 2026-07-16: reduced 16→10 (cloud) / 14→10 (local). Golden-labeled
    // analysis of the 186-topic prod baseline showed the worst 25% of topics
    // could be cut with 0% loss of true-FEED articles (19/186 fetched zero;
    // worst 55 topics consumed 23.8% of the daily article quota for zero
    // feed-worthy yield). Fewer, better-targeted topics per fact → less quota
    // waste. Deliberate product change (config.test.ts pins updated to match).
    totalCloud: 10,
    totalLocal: 10,
    temperature: 0.3,
    maxFactLength: 200,
    llmTopicWeight: 0.75,
    cloudMaxTokens: 400,
    cloudThinkingMaxTokens: 2048,
    topupTopicWeight: 0.5,
    factOnlySystemPrompt: _prompts.CLOUD_TOPIC_GENERATION_SYSTEM_PROMPT,
    comboSystemPrompt: _prompts.CLOUD_FACT_COMBO_TOPIC_GENERATION_SYSTEM_PROMPT
  },
  scoringEngine: {
    // Relevance v2 is OFF by default for the same reason and in the same style:
    // an explicit literal, not an absent key read as falsy. Nothing layers it in
    // at runtime any more; the harness default must always describe today's
    // shipped behaviour.
    RELEVANCE_V2: false,
    // affinity component weights (positives sum to ≈ 1.0 at full saturation).
    // Rebalance: W_TOPIC 0.42→0.32, the freed 0.10 → W_BREADTH.
    // freshness decay removed (W_FRESH 0.08 deleted). The remaining
    // seven positive weights are RENORMALIZED proportionally (÷0.92, the pre-rebalance
    // positive sum) so full-saturation affinity stays ≈1.0 and no borderline
    // article slips under the 0.3 render gate from a ~0.08-raw drop. Before →
    // after: 0.32→0.348, 0.10→0.109, 0.20→0.217, 0.08→0.087, 0.05→0.054,
    // 0.07→0.076, 0.10→0.109 (3dp; the seven sum to exactly 1.000).
    W_TOPIC: 0.348,
    W_BREADTH: 0.109,
    W_GEO: 0.217,
    W_ENTITY: 0.087,
    W_EVENT: 0.054,
    W_PUB: 0.076,
    W_POP: 0.109,
    // affinity → raw band
    BASE_OFFSET: 0.05,
    BASE_SLOPE: 1.05,
    BASE_MIN: 0.05,
    BASE_MAX: 1.1,
    // penalties
    P_NEG: 0.45,
    P_SUP: 0.3,
    P_SUP_CAP: 0.6,
    // == articlePipeline.discardFloor == RENDER_GATE. See the field's comment.
    ENTITY_PENALTY_FLOOR: 0.4,
    P_WRONG: 0.55,
    P_SEEN: 0.08,
    // topic weighting
    HP_MULT: 1.25,
    // breadth saturation (3+ distinct positive topics saturate)
    BREADTH_SAT: 2,
    // vectorScore modulation knees (production-only; eval rows have no vector)
    VS_LO: 0.78,
    VS_HI: 0.9,
    // popularity saturation
    POP_SAT: 32,
    // geo alignment multipliers
    GEO_CITY: 1.0,
    GEO_REGION: 0.6,
    GEO_COUNTRY: 0.3,
    // headline floor
    HEADLINE_BASE_FLOOR: 0.35,
    HEADLINE_POP_LIFT: 0.15,
    // headline section pseudo-weights (feed-select sectioning)
    HEADLINE_SECTION_BASE: 0.55,
    GLOBAL_SECTION_WEIGHT: 0.35
  },
  mutationRails: {
    NUDGE_DAY_BUDGET: 0.3
  }
};