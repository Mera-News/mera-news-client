"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "CLOUD_SCORE_CHUNK_SIZE", {
  enumerable: true,
  get: function () {
    return _scoring.CLOUD_SCORE_CHUNK_SIZE;
  }
});
Object.defineProperty(exports, "REASON_MIN_RAW_SCORE", {
  enumerable: true,
  get: function () {
    return _scoring.REASON_MIN_RAW_SCORE;
  }
});
exports.batchScoreAndReason = batchScoreAndReason;
Object.defineProperty(exports, "bucketScore", {
  enumerable: true,
  get: function () {
    return _scoring.bucketScore;
  }
});
Object.defineProperty(exports, "bucketScores", {
  enumerable: true,
  get: function () {
    return _scoring.bucketScores;
  }
});
exports.buildReasonCallsForSubset = buildReasonCallsForSubset;
exports.buildReasonCallsForSurvivors = buildReasonCallsForSurvivors;
exports.buildRelevanceCalls = buildRelevanceCalls;
exports.decodeCloudBatchResults = decodeCloudBatchResults;
exports.decodeResults = void 0;
exports.processAllUnscored = processAllUnscored;
exports.rependSkippedNotes = rependSkippedNotes;
exports.resolveReasonCallId = resolveReasonCallId;
exports.resolveReasonResultIds = resolveReasonResultIds;
exports.retryMissingReasons = retryMissingReasons;
exports.runFeedVerifierPass = runFeedVerifierPass;
var _completeLocal = require("../llm/completeLocal");
var _jobDefer = require("../inference/job-defer");
var _cloudComplete = require("../llm/cloudComplete");
var _logger = _interopRequireDefault(require("../logger"));
var _prompts = require("../news-harness/prompts/prompts");
var _prompt = require("../news-harness/on-device/notes/prompt");
var _articleSuggestionScoringWrites = require("../database/services/article-suggestion-scoring-writes");
var _articleSuggestionReads = require("../database/services/article-suggestion-reads");
var _importanceFilter = require("../feed-ordering/importance-filter");
var _meraProtocolStore = require("../stores/mera-protocol-store");
var _graphqlTypes = require("../generated/graphql-types");
var _config = require("../news-harness/core/config");
var _loggerAdapter = require("../news-harness-app/logger-adapter");
var _scoring = require("../news-harness/article-pipeline/scoring");
var _scoringDecode = require("../news-harness/article-pipeline/scoring-decode");
var _tagPrompt = require("../news-harness/article-pipeline/tag-prompt");
var _stageScoring = require("./stage-scoring");
var _idle = require("../scheduler/idle");
var _scorePropagation = require("../feed-grouping/score-propagation");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Scoring Service — On-device relevance scoring of ArticleSuggestions (two-pass)
// Pass 1: Relevance score, batched 5 articles per LLM call (one JSON array out)
// Pass 2: Reason generation per article (only for relevance at or above the feed's gate, 0.4)
//
// The PURE scoring logic (prompt building, parsing, decoding, bucketing) now
// lives in lib/news-harness/article-pipeline/scoring.ts. This module keeps the
// RN-coupled orchestration (WatermelonDB reads/writes, cloud/local LLM calls,
// the processing-mode store) and delegates the pure work to the harness,
// injecting the app logger + default config so behaviour is unchanged.

/** A propagated row is written `complete` without the scoring stage's hard screen
 * so sweep the live hard filters after the gate propagates, as feed-sync does.
 *  Lazy: suppression-sweep reaches the database at import. Never fails the pass. */
async function reconcilePropagatedHardFilters() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sweep = require("../services/suppression-sweep");
    await sweep.purgeHardFilteredSuggestions();
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'scoring-service',
        step: 'reconcile-hard-filters'
      }
    });
  }
}
const ARTICLE_CFG = _config.DEFAULT_HARNESS_CONFIG.articlePipeline;
const isOnDeviceMode = () => _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.OnDevice;
/** Whether this lane's pass can score a row: Kev needs a linked fact, the cloud takes a headline too. */
const scorableOnThisLane = c => isOnDeviceMode() ? (0, _scoring.isEligible)(c) : (0, _scoring.isScorableCandidate)(c);
/** The Skip notes switch is off. This module gates on-device notes; the cloud gate is in scoring-pipeline. */
const notesOn = () => !_meraProtocolStore.useMeraProtocolStore.getState().skipNotes;

// --- Re-exports (canonical homes moved to the harness) ---

// --- Local constants for the RN-coupled orchestration (mirror harness config) ---

/** Articles bundled into one batched relevance prompt (cloud). */
const ARTICLES_PER_SCORE_PROMPT = ARTICLE_CFG.articlesPerScorePrompt;

/** Fallback when LLM scoring fails or output is unparseable. */
const FALLBACK_RELEVANCE = ARTICLE_CFG.fallbackRelevance;

/** Default for candidates that are ineligible for scoring (no body, no facts). */
const INELIGIBLE_RELEVANCE = ARTICLE_CFG.ineligibleRelevance;

/** Output token ceiling for one batched score call. */
const SCORE_BATCH_MAX_TOKENS = ARTICLE_CFG.scoreBatchMaxTokens;

// --- Fact loading ---

// --- Batch scoring + reason generation ---
//
// The score/reason PROMPT building stays here (rather than delegating to the
// harness) so it keeps flowing through the mockable `./prompts` builders. The
// pure, prompt-independent helpers (resolveCountryName, buildUserContext,
// isEligible, chunk, parsers, bucketing, decode) come from the harness. The
// harness has its own equivalent builders for its own consumers; golden-prompts
// tests pin that the two produce byte-identical output.

function buildScoreCallForChunk(chunkCandidates, allFactStatements, systemPrompt = _prompts.CLOUD_RELEVANCE_SYSTEM_PROMPT,
/**
 * ADD 1 seam, mirroring the harness twin in
 * `news-harness/article-pipeline/scoring.ts`. Only `legacyTagPromptEnabled` is
 * read; with it false (the shipped default) this returns exactly the string it
 * always did and `injectArticleMetadata` is never called.
 *
 * This LOCAL builder exists so pass-1 prompts keep flowing through the
 * mockable `./prompts` builders, and it is the one the live app path uses —
 * patching only the harness twin would have shipped the flag to the offline
 * harness and to nothing else.
 */
config = ARTICLE_CFG) {
  const userContext = (0, _scoring.buildUserContext)(allFactStatements, (0, _scoring.localDay)(Date.now()));
  const prompt = (0, _prompts.buildBatchScoringUserMessage)({
    userContext,
    articles: chunkCandidates.map(c => ({
      title: c.titleEn ?? '',
      description: c.descriptionEn ?? '',
      country: (0, _scoring.resolveCountryName)(c.countryCode),
      publication: (0, _scoring.buildPublicationLabel)(c.publicationName ?? c.meta?.publicationName, c.languageCode),
      relatedFacts: c.relatedFacts.map(_scoring.relatedFactLine)
    }))
  });
  return {
    prompt: config.legacyTagPromptEnabled ? (0, _tagPrompt.injectArticleMetadata)(prompt, chunkCandidates) : prompt,
    system: systemPrompt
  };
}

/**
 * ONE reason call for ONE candidate, on whichever lane this device is using.
 *
 * Returns the pass-2 score alongside the sentence on the CLOUD lane only. The
 * on-device GGUF lane keeps its plain-string contract: `LOCAL_REASON_SYSTEM_PROMPT`
 * is built on a different base, states its own voice rule, and is exercised by
 * no runner, so giving it an unmeasured output contract would be a change
 * nobody could check. `parseReasonResult` fails open on a plain string anyway,
 * so this is belt and braces — and it is the braces that say so out loud.
 */
async function generateReasonForCandidate(candidate, userContext, relevance) {
  if (isOnDeviceMode()) {
    // On-device notes have their own prompt (news-harness/on-device/notes): a
    // plain sentence, no score contract, so only the sentence is kept.
    const {
      system,
      prompt
    } = (0, _prompt.buildNotePrompt)({
      userContext,
      articleTitle: candidate.titleEn ?? '',
      articleDescription: candidate.descriptionEn ?? '',
      articleCountry: (0, _scoring.resolveCountryName)(candidate.countryCode),
      relevance,
      relatedFacts: candidate.relatedFacts.map(f => f.statement)
    });
    const output = await (0, _completeLocal.completeLocal)({
      systemPrompt: system,
      prompt,
      maxTokens: ARTICLE_CFG.reasonMaxTokens,
      temperature: ARTICLE_CFG.reasonTemperature,
      responseFormat: 'text',
      label: 'reason'
    });
    return {
      reason: (0, _scoringDecode.parseReasonResult)(output, candidate.id, prompt, _loggerAdapter.appHarnessLogger).reason
    };
  }
  const onDevice = isOnDeviceMode();
  // The two builders differ ONLY in field order. Local leads with `User Context`
  // so llama.cpp's prefix cache can reuse the fact bank across a batch instead
  // of re-prefilling it per article; cloud keeps the shared builder byte-for-byte,
  // because `golden-prompts.test.ts` pins it and cloud quality is calibrated
  // against it. This is the only place the two paths diverge on the user message.
  const buildUserMessage = onDevice ? _prompts.buildLocalReasonUserMessage : _prompts.buildReasonUserMessage;
  const userMessage = buildUserMessage({
    userContext,
    articleTitle: candidate.titleEn ?? '',
    articleDescription: candidate.descriptionEn ?? '',
    articleCountry: (0, _scoring.resolveCountryName)(candidate.countryCode),
    publication: (0, _scoring.buildPublicationLabel)(candidate.publicationName ?? candidate.meta?.publicationName, candidate.languageCode),
    relevance,
    relatedFacts: candidate.relatedFacts.map(_scoring.relatedFactLine)
  });
  const output = onDevice ? await (0, _completeLocal.completeLocal)({
    systemPrompt: _prompts.LOCAL_REASON_SYSTEM_PROMPT,
    prompt: userMessage,
    maxTokens: ARTICLE_CFG.reasonMaxTokens,
    temperature: ARTICLE_CFG.reasonTemperature,
    // LOCAL_REASON_SYSTEM_PROMPT asks for "a single plain string". A
    // JSON-object grammar contradicted it (and breaks the LFM family).
    responseFormat: 'text',
    label: 'reason'
  }) : await (0, _cloudComplete.cloudComplete)({
    systemPrompt: _prompts.CLOUD_REASON_SYSTEM_PROMPT,
    prompt: userMessage,
    maxTokens: ARTICLE_CFG.reasonMaxTokens,
    temperature: ARTICLE_CFG.reasonTemperature,
    route: 'scoring'
  });
  const decoded = (0, _scoringDecode.parseReasonResult)(output, candidate.id, userMessage, _loggerAdapter.appHarnessLogger);
  return onDevice ? {
    reason: decoded.reason
  } : decoded;
}

/**
 * The unconditional top-headline cull: a headline-sourced row that lands in the
 * LOW band or below is terminal (`excluded`), never a saved suggestion —
 * headlines exist to surface what matters in a region, so a LOW one is noise on
 * every surface. Non-headline rows are NEVER culled.
 *
 * `bucketedScoreMap` must hold POST-`bucketScores` values: the predicate reads
 * the band, and raw scores don't map to bands one-to-one (a raw 0.45 buckets to
 * LOW ⇒ culled, a raw 0.55 to MEDIUM ⇒ kept).
 *
 * `candidates` must ALREADY exclude ineligible and failed rows. Both carry a
 * placeholder score (INELIGIBLE_RELEVANCE / FALLBACK_RELEVANCE) that lands in
 * the culled band, but neither is a verdict this path is entitled to make
 * terminal: an ineligible (e.g. factless) headline was never scored, and a
 * failed one must stay retryable.
 */
function collectCulledHeadlineIds(candidates, bucketedScoreMap) {
  const culled = new Set();
  for (const c of candidates) {
    if (!(0, _scoring.isHeadlineCandidate)(c)) continue;
    const relevance = bucketedScoreMap.get(c.id);
    if (relevance !== undefined && (0, _importanceFilter.isCulledHeadlineRelevance)(relevance)) culled.add(c.id);
  }
  return culled;
}
/**
 * Persona-v3: score a batch through the SINGLE math + judge stage
 * (computeAndScore, via stage-scoring), then run the reason pass for any
 * survivor that still lacks a reason. Returns RAW scores (bucketing is the
 * caller's job) plus the computed_score / components audit maps.
 *
 * `scoreMap` values are the FINAL raw score (the legacy LLM score, or the math
 * score if that call failed). `reasonMap` is filled entirely by the reason pass
 * below — the judge that used to caption some rows in the scoring call itself is
 * gone, so `!reasonMap.has(c.id)` in the survivor filter is now always true and
 * is kept only because the reason pass may run twice (retry).
 */
async function batchScoreAndReason(candidates) {
  const useOnDevice = isOnDeviceMode();
  const scoreMap = new Map();
  const reasonMap = new Map();
  const failedIds = new Set();
  const computedMap = new Map();
  const componentsJsonMap = new Map();
  let excludedIds = new Set();
  let excludedValueById = new Map();
  let culledHeadlineIds = new Set();
  let locationCaughtIds = new Set();

  // Ineligible ones get a fixed low score, never hit the engine/LLM. In the cloud a top headline
  // no fact matched is scored, as the gateway's pipeline does; Kev needs a fact to read.
  const eligible = [];
  for (const c of candidates) {
    if (scorableOnThisLane(c)) eligible.push(c);else scoreMap.set(c.id, INELIGIBLE_RELEVANCE);
  }
  if (eligible.length === 0) {
    return {
      scoreMap,
      reasonMap,
      failedIds,
      computedMap,
      componentsJsonMap,
      excludedIds,
      excludedValueById,
      culledHeadlineIds,
      locationCaughtIds
    };
  }

  // ---- ONE hard-screen + math + legacy-score stage (both orchestrators) ----
  let stage;
  try {
    stage = await (0, _stageScoring.computeAndScoreForCandidates)(eligible);
  } catch (err) {
    _logger.default.warn('[batchScoreAndReason] computeAndScore failed — fallback relevance', {
      error: err instanceof Error ? err.message : String(err),
      count: eligible.length
    });
    eligible.forEach(c => {
      scoreMap.set(c.id, FALLBACK_RELEVANCE);
      failedIds.add(c.id);
    });
    return {
      scoreMap,
      reasonMap,
      failedIds,
      computedMap,
      componentsJsonMap,
      excludedIds,
      excludedValueById,
      culledHeadlineIds,
      locationCaughtIds
    };
  }

  // ---- HARD "not interested" filters: drop before anything else ----
  // Excluded rows must never enter the scoring loop below — a missing
  // rawScoreMap entry there means "the stage failed", which would hand them
  // FALLBACK_RELEVANCE and add them to failedIds. They are neither scored nor
  // failed; they are terminal by the user's request.
  excludedIds = stage.excludedIds;
  excludedValueById = stage.excludedValueById;
  const active = excludedIds.size > 0 ? eligible.filter(c => !excludedIds.has(c.id)) : eligible;
  if (excludedIds.size > 0) {
    _logger.default.info('[batchScoreAndReason] hard filters excluded rows', {
      excluded: excludedIds.size,
      of: eligible.length,
      values: [...new Set(excludedValueById.values())].slice(0, 10)
    });
  }

  // (The judge-override capture that used to live here — shaping
  // computed-vs-judge deltas into CalibrationCases and handing them to
  // `recordOverrides` — went with the judge. It was the calibration loop's ONLY
  // input; see the note at `buildCalibrationCase`.)
  locationCaughtIds = stage.locationCaughtIds;
  for (const c of active) {
    if (locationCaughtIds.has(c.id)) {
      // Never sent to Kev, so no rawScoreMap entry: score 0 (not a failure), components kept.
      scoreMap.set(c.id, 0);
      const caughtComps = stage.componentsMap.get(c.id);
      if (caughtComps) componentsJsonMap.set(c.id, JSON.stringify(caughtComps));
      continue;
    }
    const raw = stage.rawScoreMap.get(c.id);
    if (raw === undefined) {
      scoreMap.set(c.id, FALLBACK_RELEVANCE);
      failedIds.add(c.id);
      continue;
    }
    scoreMap.set(c.id, raw);
    const computed = stage.computedScoreMap.get(c.id);
    if (computed !== undefined) computedMap.set(c.id, computed);
    const comps = stage.componentsMap.get(c.id);
    if (comps) componentsJsonMap.set(c.id, JSON.stringify(comps));
  }

  // ---- Reason pass: every survivor >= reasonRelevanceThreshold. ----
  // Top-headline cull, decided here and carried out by the caller. Dropping the
  // culled rows from the survivor set spends no reason tokens on a row that
  // ends up terminally `excluded` (its reason would be discarded with it).
  // `scoreMap` is RAW at this point, so the cull needs its own bucketed copy.
  const bucketedForCull = new Map(scoreMap);
  (0, _scoring.bucketScores)(bucketedForCull);
  culledHeadlineIds = collectCulledHeadlineIds(active.filter(c => !failedIds.has(c.id) && !locationCaughtIds.has(c.id)), bucketedForCull);
  const survivors = active.filter(c => {
    const r = scoreMap.get(c.id);
    return typeof r === 'number' && r >= ARTICLE_CFG.reasonRelevanceThreshold && !reasonMap.has(c.id) && !failedIds.has(c.id) && !culledHeadlineIds.has(c.id);
  });

  // On this phone the notes are written after the whole pass (retryMissingReasons), so each model
  // loads once per sync.
  if (survivors.length > 0 && !useOnDevice && notesOn()) {
    const allFactStatements = await (0, _stageScoring.loadAllFactStatements)();
    const phase2 = buildReasonCallsForSurvivors(survivors, scoreMap, allFactStatements);
    // A refused request keeps the relevance pass: the rows save as `reason_pending` and the
    // reason sweep owes them a note, the same outcome as the on-device catch above.
    try {
      const reasonResults = await (0, _cloudComplete.cloudBatchComplete)(phase2.calls, 'scoring');
      const orderedIds = phase2.eligibleCandidates.map(c => c.id);
      const decodedReasons = decodeCloudBatchResults({
        batchResults: resolveReasonResultIds(reasonResults, orderedIds),
        promptsById: new Map([...phase2.promptsById].map(([id, prompt]) => [resolveReasonCallId(id, orderedIds) ?? id, prompt])),
        chunkIdToCandidates: phase2.chunkIdToCandidates
      });
      for (const [id, reason] of decodedReasons.reasonMap) reasonMap.set(id, reason);
      for (const id of decodedReasons.failedIds) failedIds.add(id);
      // The pass-2 score replaces pass 1's, IN `scoreMap`, which is still raw
      // here. `processAllUnscored` snapshots it as `raw_score` and buckets it
      // into `relevance` immediately after this returns, so both columns end up
      // describing the same judgement instead of two different ones.
      for (const [id, rescored] of decodedReasons.rescoreMap) {
        if (failedIds.has(id) || !scoreMap.has(id)) continue;
        scoreMap.set(id, (0, _scoring.applyRescorePolicy)(scoreMap.get(id), rescored));
      }
    } catch (err) {
      _logger.default.warn('[batchScoreAndReason] cloud reason request failed', {
        count: survivors.length,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return {
    scoreMap,
    reasonMap,
    failedIds,
    computedMap,
    componentsJsonMap,
    excludedIds,
    excludedValueById,
    culledHeadlineIds,
    locationCaughtIds
  };
}

// ---------------------------------------------------------------------------
// Cloud-call builders — thin wrappers over the harness builders that inject the
// user's full fact bank (loaded from WatermelonDB), the default config, and the
// app logger. Signatures are UNCHANGED from before the harness split.
// ---------------------------------------------------------------------------

/**
 * Sync cloud phase-2: build reason BatchCalls for the survivors — candidates
 * whose phase-1 score cleared the feed's gate.
 */
function buildReasonCallsForSurvivors(survivors, scoreMap, allFactStatements) {
  const calls = [];
  const promptsById = new Map();
  // In call order: position n of a `reason:<n>` id maps to called[n], never to a
  // survivor that was skipped and got no call.
  const called = [];
  const fullUserContext = (0, _scoring.buildUserContext)(allFactStatements, (0, _scoring.localDay)(Date.now()));
  for (const c of survivors) {
    const relevance = scoreMap.get(c.id);
    if (typeof relevance !== 'number') continue;
    const reasonPrompt = (0, _prompts.buildReasonUserMessage)({
      userContext: fullUserContext,
      articleTitle: c.titleEn ?? '',
      articleDescription: c.descriptionEn ?? '',
      articleCountry: (0, _scoring.resolveCountryName)(c.countryCode),
      publication: (0, _scoring.buildPublicationLabel)(c.publicationName ?? c.meta?.publicationName, c.languageCode),
      relevance,
      relatedFacts: c.relatedFacts.map(_scoring.relatedFactLine)
    });
    const reasonId = `reason:${calls.length}`;
    promptsById.set(reasonId, reasonPrompt);
    called.push(c);
    calls.push({
      id: reasonId,
      // A TOP-HEADLINE row gets the headline reason prompt (same impact
      // rubric its score pass ran), so the note can name the causal mechanism
      // the scorer accepted. One call per candidate ⇒ no chunking constraint,
      // so this is a straight per-candidate selection.
      system: (0, _scoring.reasonSystemPromptFor)(ARTICLE_CFG, (0, _scoring.isHeadlineCandidate)(c) ? 'headline' : 'standard'),
      prompt: reasonPrompt,
      temperature: ARTICLE_CFG.reasonTemperature,
      maxTokens: ARTICLE_CFG.reasonMaxTokens
    });
  }
  return {
    calls,
    promptsById,
    chunkIdToCandidates: new Map(),
    eligibleCandidates: called
  };
}

/**
 * Phase-1 of the two-phase async flow: score-only calls, no reason prompts.
 * Loads the user's fact bank internally so callers keep the original signature.
 *
 * Every chunk holds `articlesPerScorePrompt` candidates, headlines included.
 * The system prompt is chosen PER CHUNK — a chunk of TOP-HEADLINE
 * candidates only takes the indirect-impact prompt, any other the standard
 * one. The selection helpers are imported from the harness (never re-derived
 * here) so the two paths cannot drift; the size used comes back on the bundle
 * for the async decoder to persist.
 */
async function buildRelevanceCalls(candidates,
/**
 * The EFFECTIVE articlePipeline config for this batch.
 *
 * v4 (ADD 1, `legacyTagPromptEnabled`) is a RUNTIME toggle, so this can no
 * longer be read off the module-level `ARTICLE_CFG` literal: that literal is
 * `DEFAULT_HARNESS_CONFIG.articlePipeline`, frozen at import, and a user
 * flipping the switch would have changed the offline harness twin and nothing
 * the app actually sends. This is the threading the ADD-1 comment below
 * predicted would be needed.
 *
 * Defaults to `ARTICLE_CFG` so every non-pipeline caller (and every test that
 * predates the toggle) keeps the exact literal it had before.
 */
config = ARTICLE_CFG) {
  // isScorableCandidate, not isEligible — a pure TOP-HEADLINE row is factless by
  // design. Dropping it here would leave the batch's rows Unscored with NO score
  // write (the empty-bundle branch in scoring-pipeline markBatchDone's and
  // returns), so every later gate pass would re-elect them: an unbounded churn
  // loop rather than a visible headline.
  const eligible = candidates.filter(_scoring.isScorableCandidate);
  const scoreChunkSize = config.articlesPerScorePrompt;
  const chunks = (0, _scoring.chunk)(eligible, scoreChunkSize);
  const allFactStatements = await (0, _stageScoring.loadAllFactStatements)();
  const calls = [];
  const promptsById = new Map();
  const chunkIdToCandidates = new Map();
  chunks.forEach((chunkCandidates, idx) => {
    const {
      prompt,
      system
    } = buildScoreCallForChunk(chunkCandidates, allFactStatements, (0, _scoring.relevanceSystemPromptFor)(config, (0, _scoring.resolveScoringVariant)(chunkCandidates)),
    // ADD 1 seam — now fed the EFFECTIVE config (see the `config` param),
    // which is what makes the v4 toggle reach the calls the app really sends.
    // Nothing about the OUTPUT CONTRACT changes with the flag (the tag block
    // is prompt INPUT only), so unlike `legacyNoteDemote` this needs no
    // per-batch capture: a mid-flight OTA cannot mis-parse anything.
    config);
    const scoreId = `score:${idx}`;
    promptsById.set(scoreId, prompt);
    chunkIdToCandidates.set(scoreId, chunkCandidates);
    calls.push({
      id: scoreId,
      system,
      prompt,
      temperature: config.scoreTemperature,
      // Deliberately the module constant, not `config.scoreBatchMaxTokens`:
      // this is not a v4 flag and the project rules name it a value that must not move
      // without a scored comparison. Keeping the literal keeps the diff honest.
      maxTokens: SCORE_BATCH_MAX_TOKENS
    });
  });
  return {
    calls,
    promptsById,
    chunkIdToCandidates,
    eligibleCandidates: eligible,
    scoreChunkSize
  };
}

/**
 * Phase-2 of the two-phase async flow: reason-only calls for the subset of
 * candidates whose relevance is at least `subsetThreshold`.
 */
async function buildReasonCallsForSubset(candidates, relevanceMap, subsetThreshold,
/**
 * v3 routes this pass to `v3NoteSystemPrompt`, which does one job the legacy
 * reason prompt cannot: it may DEMOTE. v3 absorbed the standalone verifier
 * pass when it merged scoring and prose into one call, and lost its demote
 * rules with it — 45.1% of what cleared the gate was judged "skip" by the
 * blind panel. This is where that pressure comes back, at no extra call: the
 * same rows had to be visited to write their notes anyway.
 *
 * The USER MESSAGE is identical either way. `buildReasonUserMessage` already
 * carries the article, its score and the retrieval facts, which is exactly
 * what a precision judgement needs too.
 *
 * Defaults false, so the legacy path is untouched.
 */
v3 = false,
/**
 * The EFFECTIVE articlePipeline config for this batch — see the same
 * parameter on {@link buildRelevanceCalls}. v4 (ADD 2,
 * `legacyTagReasonGateEnabled`) is read from it below, so the runtime toggle
 * reaches the calls the app really sends rather than only the harness twin.
 */
config = ARTICLE_CFG) {
  const eligible = candidates.filter(c => {
    // This is the LIVE reason path (scoring-pipeline :1231 and :1846). Fixing
    // only the harness twin would fix the offline harness and leave prod
    // broken: a factless headline scoring 0.6 would get no reason, stay
    // `reason_pending`, and isVisible would keep it invisible.
    if (!(0, _scoring.isScorableCandidate)(c)) return false;
    const rel = relevanceMap[c.id];
    // Inclusive, as the inline gate (`>= reasonRelevanceThreshold`): a row at exactly the gate is owed a note.
    return typeof rel === 'number' && rel >= subsetThreshold;
  });

  // ADD 2, mirroring the harness twin exactly (`article-pipeline/scoring.ts`).
  // Applied AFTER the relevance gate so it can only ever REMOVE rows that would
  // have been called, never resurrect one the threshold excluded.
  //
  // Returning the ids is half the contract: the caller MUST persist
  // `feedVerifierDemoteScore` for them. See `CloudCallBundle.tagGatedDemoteIds`.
  const tagGatedDemoteIds = (0, _tagPrompt.selectTagGatedDemoteIds)(eligible, config);
  const gatedSet = new Set(tagGatedDemoteIds);
  const subset = gatedSet.size === 0 ? eligible : eligible.filter(c => !gatedSet.has(c.id));
  const calls = [];
  const promptsById = new Map();
  const allFactStatements = await (0, _stageScoring.loadAllFactStatements)();
  const fullUserContext = (0, _scoring.buildUserContext)(allFactStatements, (0, _scoring.localDay)(Date.now()));
  for (const c of subset) {
    const reasonPrompt = (0, _prompts.buildReasonUserMessage)({
      userContext: fullUserContext,
      articleTitle: c.titleEn ?? '',
      articleDescription: c.descriptionEn ?? '',
      articleCountry: (0, _scoring.resolveCountryName)(c.countryCode),
      publication: (0, _scoring.buildPublicationLabel)(c.publicationName ?? c.meta?.publicationName, c.languageCode),
      relevance: relevanceMap[c.id],
      relatedFacts: c.relatedFacts.map(_scoring.relatedFactLine)
    });
    const reasonId = `reason:${calls.length}`;
    promptsById.set(reasonId, reasonPrompt);
    calls.push({
      id: reasonId,
      // A TOP-HEADLINE row gets the headline reason prompt (same impact
      // rubric its score pass ran), so the note can name the causal mechanism
      // the scorer accepted. One call per candidate ⇒ no chunking constraint,
      // so this is a straight per-candidate selection.
      // The v3 note prompt is deliberately NOT split headline/standard: it
      // judges ONE article against the user's facts, and that distinction
      // exists to change how an article is retrieved and SCORED — which pass 1
      // has already settled by the time we reach here.
      system: v3 ? config.v3NoteSystemPrompt : (0, _scoring.reasonSystemPromptFor)(config, (0, _scoring.isHeadlineCandidate)(c) ? 'headline' : 'standard'),
      prompt: reasonPrompt,
      temperature: config.reasonTemperature,
      maxTokens: v3 ? config.v3NoteMaxTokens : config.reasonMaxTokens
    });
  }
  return {
    calls,
    promptsById,
    chunkIdToCandidates: new Map(),
    eligibleCandidates: subset,
    tagGatedDemoteIds
  };
}

/**
 * Decode a raw BatchCompletionResult[] back into per-candidate score + reason
 * maps. Thin wrapper that injects the app logger + default config.
 */
function decodeCloudBatchResults(params) {
  return (0, _scoringDecode.decodeCloudBatchResults)(params, ARTICLE_CFG, _loggerAdapter.appHarnessLogger);
}

/**
 * A reasons call id travels outside the E2EE envelope, so it must not be an
 * article id: it is `reason:<position>` in the submitted list. This maps a result
 * id back to `reason:<article id>` for the decoders. A 1-6 digit suffix is a
 * position (out of range -> null); anything else (a batch submitted before ids
 * went positional carries `reason:<24-hex id>`) is already an id and passes
 * through. Non-reason ids pass through untouched.
 */
function resolveReasonCallId(id, orderedIds) {
  const m = /^reason:(\d{1,6})$/.exec(id);
  if (!m) return id;
  const articleId = orderedIds[Number(m[1])];
  return articleId === undefined ? null : `reason:${articleId}`;
}

/** {@link resolveReasonCallId} over a result list; a result whose position is unknown is dropped. */
function resolveReasonResultIds(results, orderedIds) {
  const out = [];
  for (const r of results) {
    const id = resolveReasonCallId(r.id, orderedIds);
    if (id === null) {
      _logger.default.warn('[resolveReasonResultIds] result position outside the submitted list', {
        callId: r.id,
        submitted: orderedIds.length
      });
      continue;
    }
    out.push(id === r.id ? r : {
      ...r,
      id
    });
  }
  return out;
}

/** Exported alias so the reconciler can import a canonical helper name. */
const decodeResults = exports.decodeResults = decodeCloudBatchResults;

// --- Second-pass FEED verifier (cloud) ---
//
// Runs the validated second-pass FEED verifier over a batch's freshly-decoded
// RAW scores, demoting clear first-pass false positives out of FEED. Mutates
// `scoreMap` IN PLACE (raw scores) and returns the number of articles demoted.
//
// This is the production wiring point for the pipelined cloud path
// (scoring-pipeline.ts::handleRelevanceResults calls it after score decode,
// before bucketing/persist). The verifier LLM call goes through the SAME E2EE
// primitive as the first pass (`cloudBatchComplete`) — article content + facts
// are encrypted client-side, so the privacy model is preserved. FAIL-OPEN: any
// error (LLM failure, empty facts) leaves every score untouched. Gated by
// config.feedVerifierEnabled. `candidates` must carry title/description/facts
// (as returned by getUnscoredSuggestionsWithFacts).
async function runFeedVerifierPass(candidates, scoreMap) {
  if (!ARTICLE_CFG.feedVerifierEnabled) return 0;
  const feedCandidates = candidates.filter(c => (scoreMap.get(c.id) ?? 0) >= ARTICLE_CFG.discardFloor);
  if (feedCandidates.length === 0) return 0;
  try {
    const allFactStatements = await (0, _stageScoring.loadAllFactStatements)();
    const {
      calls,
      verifyIdToCandidates
    } = (0, _scoring.buildFeedVerifierCalls)(feedCandidates, allFactStatements, ARTICLE_CFG, _loggerAdapter.appHarnessLogger, (0, _scoring.localDay)(Date.now()));
    if (calls.length === 0) return 0;
    const results = await (0, _cloudComplete.cloudBatchComplete)(calls, 'scoring');
    const demoted = (0, _scoringDecode.applyFeedVerifierDecisions)(scoreMap, verifyIdToCandidates, results, ARTICLE_CFG, _loggerAdapter.appHarnessLogger);
    _logger.default.info('[runFeedVerifierPass] verified batch', {
      audited: feedCandidates.length,
      demoted
    });
    return demoted;
  } catch (err) {
    _logger.default.warn('[runFeedVerifierPass] verifier failed — scores unchanged', {
      error: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }
}

// --- Main entry: score every unscored row ---

/**
 * On this phone the pass is two phases: Kev scores every unscored row, then the built-in
 * model writes the notes (the sweep at the end; none with Skip notes on). The sweep runs even
 * when nothing was unscored, since an earlier pass may have left notes owed.
 *
 * Queued background jobs (topic generation after a saved fact) are NOT held off: the built-in
 * model runs out of process and Kev stays loaded, so there is no model swap to protect, and
 * every call already takes the llama lock, so a job slots in between two articles or two notes.
 * Holding the queue for the pass made a new fact wait minutes for its topics (owner, 2026-10-21).
 */
async function processAllUnscored(onProgress, batchSize = 20, onBatchComplete,
/** False ends the pass: rows not yet scored stay unscored, never marked failed (the RedPill
 *  inline pass stops when the app leaves the front). */
shouldContinue = () => true) {
  return scoreUnscoredRows(onProgress, batchSize, onBatchComplete, shouldContinue);
}
async function sweepNotes(batchSize) {
  // Non-fatal: rows that stay owed are picked up by the next pass.
  try {
    await retryMissingReasons(batchSize);
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'scoring-service',
        method: 'processAllUnscored.retry'
      }
    });
  }
}
async function scoreUnscoredRows(onProgress, batchSize, onBatchComplete, shouldContinue) {
  const totalUnscored = await (0, _articleSuggestionReads.countUnscoredSuggestions)();
  if (totalUnscored === 0) {
    onProgress?.(0, 0);
    // In the cloud the async orphaned-reasons sweep owes these notes; with no jobs, this pass does.
    if (isOnDeviceMode() || !(0, _cloudComplete.transportServesJobs)()) await sweepNotes(batchSize);
    return 0;
  }
  let totalProcessed = 0;
  // Rows that left `unscored` without a Kev call (a copy inherited its story's score,
  // or the reader already opened the story): progress only, never the returned count.
  let settledByGate = 0;
  // Copies Kev did not answer this pass: out of the election and the batch, so the
  // gate elects a sibling instead of the same copy every loop.
  const failedThisPass = new Set();
  let retriedLoneFailure = false;
  onProgress?.(0, totalUnscored);
  let stopped = false;
  while (true) {
    if (!shouldContinue()) {
      stopped = true;
      break;
    }
    // One Kev read per story. Each pass the gate copies fresh scores onto same-story
    // copies (so it propagates after every batch) and elects one copy per story still
    // unscored. Rows this lane cannot score stay out of the election, or an elected one
    // would hand its fixed low score to the whole story; they go after the elected ones.
    const unscored = await (0, _articleSuggestionReads.getUnscoredSuggestionsWithFacts)();
    if (unscored.length === 0) break;
    const unscorable = new Set(unscored.filter(c => !scorableOnThisLane(c)).map(c => c.id));
    const gate = await (0, _scorePropagation.gateUnscoredForScoring)(new Set([...unscorable, ...failedThisPass]));
    if (gate.propagatedCount > 0) await reconcilePropagatedHardFilters();
    settledByGate += gate.propagatedCount + gate.readCount;
    const elected = new Set(gate.enqueueIds);
    const batch = [...unscored.filter(c => elected.has(c.id)), ...unscored.filter(c => unscorable.has(c.id))].filter(c => !failedThisPass.has(c.id)).slice(0, batchSize);
    if (batch.length === 0) break;
    const {
      scoreMap,
      reasonMap,
      failedIds,
      computedMap,
      componentsJsonMap,
      excludedIds,
      culledHeadlineIds,
      locationCaughtIds
    } = await batchScoreAndReason(batch);

    // Snapshot RAW (post-judge) scores before bucketing — persisted as
    // raw_score for within-section ordering (the bucketed value is `relevance`).
    const rawMap = new Map(scoreMap);
    // Bucket qualifying raw scores into LOW (0.4) / MEDIUM (0.6) / HIGH (0.8) /
    // EMERGENCY (1.1). Below-threshold rows stay untouched and are discarded.
    (0, _scoring.bucketScores)(scoreMap);
    const succeeded = [];

    // Hard-filtered + culled-headline rows: ONE terminal write, no scoring
    // result (saveScoringResult would overwrite the terminal Excluded status).
    // They count as processed (they DID leave `unscored`, so the loop still
    // terminates and onProgress's denominator stays honest) and are emitted to
    // onBatchComplete exactly like a discarded row so the store refreshes.
    if (excludedIds.size > 0 || culledHeadlineIds.size > 0) {
      const ids = [...new Set([...excludedIds, ...culledHeadlineIds])];
      try {
        await (0, _articleSuggestionScoringWrites.batchMarkExcluded)(ids);
        for (const id of ids) succeeded.push({
          id,
          relevance: 0,
          reason: null
        });
      } catch (err) {
        _logger.default.error('[processAllUnscored] batchMarkExcluded failed', err, {
          count: ids.length
        });
      }
    }
    if (culledHeadlineIds.size > 0) {
      _logger.default.info('[processAllUnscored] culled low-band top headlines', {
        culled: culledHeadlineIds.size,
        of: batch.length
      });
    }
    await Promise.all(batch.map(async candidate => {
      if (failedIds.has(candidate.id) || excludedIds.has(candidate.id) || culledHeadlineIds.has(candidate.id)) return;
      const relevance = scoreMap.get(candidate.id) ?? 0.3;
      const reason = reasonMap.get(candidate.id) ?? '';
      // A row below the feed's gate (0.4) is never written a note, on either lane, as the
      // gateway's async pipeline does; with Skip notes on no row is. Both end `complete` with
      // no note, never `reason_skipped`, which the feed does not show. A location-caught row
      // is owed no note on either lane.
      const reasonSkipped = locationCaughtIds.has(candidate.id) || !notesOn() || relevance < (isOnDeviceMode() ? ARTICLE_CFG.lowPriorityScore : ARTICLE_CFG.reasonRelevanceThreshold);
      try {
        await (0, _articleSuggestionScoringWrites.saveScoringResult)(candidate.id, {
          relevance,
          reason,
          reasonSkipped,
          computedScore: computedMap.get(candidate.id),
          rawScore: rawMap.get(candidate.id),
          scoreComponentsJson: componentsJsonMap.get(candidate.id)
        });
        succeeded.push({
          id: candidate.id,
          relevance,
          reason: reason || null
        });
      } catch (err) {
        _logger.default.error('[processAllUnscored] saveScoringResult failed', err, {
          id: candidate.id
        });
      }
    }));
    if (succeeded.length > 0 && onBatchComplete) onBatchComplete(succeeded);
    // Told to stop mid-batch: what failed failed for that reason, not the model's. Left unscored.
    if (!shouldContinue()) {
      totalProcessed += succeeded.length;
      stopped = true;
      break;
    }
    for (const id of failedIds) failedThisPass.add(id);
    // Kev answered nothing usable for these (no answer, an error, a timeout).
    await (0, _articleSuggestionScoringWrites.batchMarkScoreFailed)([...failedIds]);
    totalProcessed += succeeded.length;
    onProgress?.(totalProcessed + settledByGate, totalUnscored);

    // A whole failed batch means Kev is down, except a batch that was ONE copy with
    // siblings left (a lone story): try a sibling once before stopping.
    const loneCopy = batch.length === 1 && (gate.coveredIdsByRep[batch[0].id]?.length ?? 0) > 1;
    if (succeeded.length === 0 && loneCopy && !retriedLoneFailure) {
      retriedLoneFailure = true;
    } else if (succeeded.length === 0) {
      _logger.default.warn('[processAllUnscored] entire batch failed — stopping to retry next cycle', {
        failedCount: failedIds.size
      });
      break;
    }

    // Yield to interactions between scoring batches so the on-device pass
    // (which runs entirely on the JS thread) doesn't starve rendering/touch —
    // the just-scored batch can paint before the next batch is fetched + scored.
    await (0, _idle.yieldToInteractions)();
  }
  onProgress?.(totalProcessed + settledByGate, totalUnscored);
  if (stopped) return totalProcessed;

  // After scoring fresh rows, sweep any previously-scored rows whose reason
  // generation failed (reason_generation_completed = false). Non-fatal.
  await sweepNotes(batchSize);

  // Subscription reads: how a publication the user PAYS FOR covered each of
  // these stories. Last, non-fatal, and cheap to skip — it exits on its first
  // line for anyone with no subscriptions, which is almost everyone.
  //
  // Deliberately outside `totalProcessed`: that number is the scoring result
  // the caller reports and acts on, and a read is optional polish that must
  // never inflate or deflate it.
  try {
    // LAZY REQUIRE, deliberately. `stage-subscription-read` reaches
    // `lib/database/index`, which constructs the SQLite adapter at module
    // evaluation — a top-level import here would put that in the module graph
    // of every suite that imports scoring-service, and the jest WORKER dies
    // with `initializeJSI` rather than an assertion failing. Requiring it at
    // the call site keeps the cost where the work is. Same shape as logger's
    // lazy requires.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      runSubscriptionReadStage
    } = require("./stage-subscription-read");
    await runSubscriptionReadStage();
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'scoring-service',
        method: 'processAllUnscored.subscriptionRead'
      }
    });
  }
  return totalProcessed;
}

/**
 * On-device notes, written after the scoring pass: every row still owed one, highest relevance
 * first so a stopped pass leaves the best rows with notes. Each note is saved as it lands.
 */
async function writeNotesOnDevice() {
  const all = await (0, _articleSuggestionReads.getScoredSuggestionsWithoutReasons)();
  if (all.length === 0) return 0;
  // Skip notes on: every row still owed one is finalised without it.
  if (!notesOn()) {
    await (0, _articleSuggestionScoringWrites.batchMarkReasonSkipped)(all.map(c => c.id));
    return 0;
  }
  // Rows below the feed's gate get no note on this phone. A row saved pending before that rule
  // (an earlier pass, or an update from the single-model build) is finalized here, or it would be
  // read on every sweep for its 48 hours.
  const gate = ARTICLE_CFG.lowPriorityScore;
  const below = all.filter(c => typeof c.relevance === 'number' && c.relevance < gate).map(c => c.id);
  if (below.length > 0) await (0, _articleSuggestionScoringWrites.batchMarkReasonSkipped)(below);
  const owed = all.filter(c => typeof c.relevance !== 'number' || c.relevance >= gate);
  // One note per story x relevance: the rest are filled from a reasoned sibling
  // now, or get the rep's note copied as it lands.
  const plan = await (0, _scorePropagation.planStoryNotes)(owed.map(c => c.id), new Set(), new Set(owed.filter(_scoring.isScorableCandidate).map(c => c.id)));
  const reps = new Set(plan.repIds);
  const toWrite = owed.filter(c => reps.has(c.id));
  toWrite.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  const fullUserContext = (0, _scoring.buildUserContext)(await (0, _stageScoring.loadAllFactStatements)(false));
  let written = plan.filled;
  for (const candidate of toWrite) {
    // Skip notes turned on mid-sweep: stop; the next sweep finalises what is left.
    if (!notesOn()) break;
    // isScorableCandidate covers both the text and the fact test. A pure TOP-HEADLINE row is
    // factless by design and must still get its note.
    if (!(0, _scoring.isScorableCandidate)(candidate)) continue;
    try {
      const {
        reason
      } = await generateReasonForCandidate(candidate, fullUserContext, candidate.relevance ?? 0.7);
      if (!reason) {
        (0, _scorePropagation.noteStoryNoteFailure)(candidate.id, plan.coveredByRep[candidate.id] ?? []);
        continue;
      }
      await (0, _articleSuggestionScoringWrites.saveReason)(candidate.id, reason);
      written += 1;
      const siblings = (plan.coveredByRep[candidate.id] ?? []).filter(id => id !== candidate.id);
      written += await (0, _scorePropagation.copyNoteToSiblings)(siblings, reason);
    } catch (err) {
      // The built-in model is busy (quota, background) or gone: every next
      // note would fail the same way. Stop; the rest stay reason_pending for
      // the next sweep.
      if ((0, _jobDefer.isOnDeviceDeferrable)(err)) break;
      (0, _scorePropagation.noteStoryNoteFailure)(candidate.id, plan.coveredByRep[candidate.id] ?? []);
      _logger.default.warn('[writeNotesOnDevice] note failed', {
        id: candidate.id,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return written;
}

/**
 * Skip notes turned off, in either mode: rows at or above the feed's gate
 * that were finalised without a note are owed one again (`reason_pending`). Each
 * mode's sweep writes them: on this phone the notes sweep at the end of the next
 * scoring pass, in the cloud the orphaned-reasons sweep (`enqueueOrphanedReasons`)
 * of the next scoring cycle. The cloud gate equals this one (REASON_RELEVANCE_THRESHOLD, 0.4).
 */
function rependSkippedNotes() {
  return (0, _articleSuggestionScoringWrites.rependNotelessRows)(ARTICLE_CFG.lowPriorityScore);
}

// --- Reason retry: regenerate reasons for rows where the first pass returned empty ---

/**
 * Re-runs reason generation for cluster suggestions that were scored in a
 * previous sync but whose reason came back empty. Quiet background pass.
 * Returns the count of rows whose reason was successfully populated.
 */
async function retryMissingReasons(batchSize = 10) {
  const useOnDevice = isOnDeviceMode();
  if (useOnDevice) return writeNotesOnDevice();
  let totalRecovered = 0;
  // saveReason drops an ungrounded note, so a row can stay owed after it was asked about. Each
  // owed row is asked about once per call; the next sync picks up whatever is still owed.
  const asked = new Set();
  while (true) {
    const batch = (await (0, _articleSuggestionReads.getScoredSuggestionsWithoutReasons)(batchSize)).filter(c => !asked.has(c.id));
    if (batch.length === 0) break;
    for (const c of batch) asked.add(c.id);
    const reasonMap = new Map();
    // Sparse: only rows whose pass-2 response carried a parseable score. An
    // absent id means the row keeps the relevance it already had.
    const rescoreMap = new Map();
    const allFactStatements = await (0, _stageScoring.loadAllFactStatements)();
    const fullUserContext = (0, _scoring.buildUserContext)(allFactStatements, (0, _scoring.localDay)(Date.now()));
    {
      // Cloud path — single batch call for all reason prompts in this batch.
      const calls = [];
      const promptsById = new Map();
      for (const candidate of batch) {
        // Same leak on the cloud half — see the local branch above.
        if (!(0, _scoring.isScorableCandidate)(candidate)) continue;
        const reasonPrompt = (0, _prompts.buildReasonUserMessage)({
          userContext: fullUserContext,
          // `?? ''` is for the TYPE only: isScorableCandidate already guarantees
          // both are non-empty (it requires title+description on every branch).
          // The old code narrowed via an explicit `!titleEn || !descriptionEn`
          // continue, which the predicate now subsumes.
          articleTitle: candidate.titleEn ?? '',
          articleDescription: candidate.descriptionEn ?? '',
          articleCountry: (0, _scoring.resolveCountryName)(candidate.countryCode),
          publication: (0, _scoring.buildPublicationLabel)(candidate.publicationName ?? candidate.meta?.publicationName, candidate.languageCode),
          relevance: candidate.relevance ?? 0.7,
          relatedFacts: candidate.relatedFacts.map(_scoring.relatedFactLine)
        });
        const reasonId = `reason:${candidate.id}`;
        promptsById.set(reasonId, reasonPrompt);
        calls.push({
          id: reasonId,
          system: (0, _scoring.reasonSystemPromptFor)(ARTICLE_CFG, (0, _scoring.isHeadlineCandidate)(candidate) ? 'headline' : 'standard'),
          prompt: reasonPrompt,
          temperature: ARTICLE_CFG.reasonTemperature,
          maxTokens: ARTICLE_CFG.reasonMaxTokens
        });
      }
      if (calls.length === 0) break;
      try {
        const batchResults = await (0, _cloudComplete.cloudBatchComplete)(calls, 'scoring');
        for (const result of batchResults) {
          const serverId = result.id.slice('reason:'.length);
          if (result.error) {
            _logger.default.warn('[retryMissingReasons] cloud reason failed', {
              id: serverId,
              error: result.error
            });
            continue;
          }
          const {
            reason,
            rescore
          } = (0, _scoringDecode.parseReasonResult)(result.output, serverId, promptsById.get(result.id), _loggerAdapter.appHarnessLogger);
          if (reason) reasonMap.set(serverId, reason);
          if (rescore) rescoreMap.set(serverId, rescore.score);
        }
      } catch (err) {
        _logger.default.captureException(err, {
          tags: {
            service: 'scoring-service',
            method: 'retryMissingReasons'
          }
        });
        break;
      }
    }

    // Persist whatever came back non-empty. Leave the empties alone — next sync
    // will pick them up again via the same query.
    //
    // A row whose pass-2 response also carried a SCORE is written through
    // `saveScoringResult` instead, so the sentence and the score it explains
    // land in one update. This sweep is the one path that can rescore a row
    // scored by an older build, which is exactly what it is for: the row is
    // here because its first reason attempt came back empty.
    await Promise.all(Array.from(reasonMap.entries()).map(async ([id, reason]) => {
      try {
        const rescored = rescoreMap.get(id);
        if (rescored !== undefined) {
          await (0, _articleSuggestionScoringWrites.saveScoringResult)(id, {
            relevance: (0, _scoring.bucketScore)(rescored),
            reason,
            reasonSkipped: false
          });
        } else {
          await (0, _articleSuggestionScoringWrites.saveReason)(id, reason);
        }
        totalRecovered += 1;
      } catch (err) {
        _logger.default.error('[retryMissingReasons] saveReason failed', err, {
          id
        });
      }
    }));

    // If the whole batch came back empty, don't loop infinitely on the same rows.
    if (reasonMap.size === 0) break;
  }
  return totalRecovered;
}