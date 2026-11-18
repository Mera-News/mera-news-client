"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildStageCandidates = buildStageCandidates;
exports.computeAndScoreForCandidates = computeAndScoreForCandidates;
exports.computeMathStage = computeMathStage;
exports.effectiveHarnessConfig = effectiveHarnessConfig;
exports.getScoringLlmPort = getScoringLlmPort;
exports.loadAllFactStatements = loadAllFactStatements;
exports.loadPersonaScoringContext = loadPersonaScoringContext;
exports.rescoreLocationCaught = rescoreLocationCaught;
var _cloudComplete = require("../llm/cloudComplete");
var _completeLocal = require("../llm/completeLocal");
var _kevRelevance = require("./kev-relevance");
var _meraProtocolStore = require("../stores/mera-protocol-store");
var _graphqlTypes = require("../generated/graphql-types");
var _config = require("../news-harness/core/config");
var _calibrationService = require("../database/services/calibration-service");
var _loggerAdapter = require("../news-harness-app/logger-adapter");
var _runStage = require("../news-harness/scoring-engine/run-stage");
var _relevance = require("../news-harness/scoring-engine/relevance");
var _calibration = require("../news-harness/scoring-engine/calibration");
var _personaContext = require("../news-harness/scoring-engine/persona-context");
var _suppression = require("../news-harness/scoring-engine/suppression");
var _locationRule = require("../news-harness/scoring-engine/location-rule");
var _factPlaces = require("../news-harness/persona-management/fact-places");
var _scoring = require("../news-harness/article-pipeline/scoring");
var _placeService = require("../place-service");
var _watermelondb = require("@nozbe/watermelondb");
var _database = _interopRequireDefault(require("../database"));
var _articleSuggestionStatus = require("../database/article-suggestion-status");
var _articleSuggestionScoringWrites = require("../database/services/article-suggestion-scoring-writes");
var _articleSuggestionMappers = require("../database/services/article-suggestion-mappers");
var _articleSuggestionReads = require("../database/services/article-suggestion-reads");
var _factService = require("../database/services/fact-service");
var _topicService = require("../database/services/topic-service");
var _locationService = require("../database/services/location-service");
var _publicationPreferenceService = require("../database/services/publication-preference-service");
var _suppressionService = require("../database/services/suppression-service");
var _storyImpressionService = require("../database/services/story-impression-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// stage-scoring — the RN-coupled bridge that loads the on-device persona
// snapshot and routes scoring candidates through the ONE scoring stage
// (scoring-engine/run-stage::computeAndScore). Both scoring orchestrators build
// on this, so the hard screen + math behaviour cannot drift between them (the
// "no divergence" guarantee).
//
//  - loadPersonaScoringContext(): reads topics/locations/pub-prefs/suppressions
//    + fact weights → the plain PersonaScoringContext + a topicId→weight map.
//  - buildStageCandidates(): maps ScoringCandidate[] (with their persisted
//    metadata columns) → StageCandidate[] the engine scores.
//  - computeAndScoreForCandidates(): the sync inline path (the LLM round-trip
//    happens inline via an LlmPort). The E2EE pipeline uses
//    loadPersonaScoringContext + buildStageCandidates + the pure engine directly
//    (its LLM call is a deferred encrypted job), so both share the identical
//    hard screen, math and persona.

// source-pref v47: this reads ALL active rows, including the live SCOPE
// rows (`scope_kind='country'`) whose `publication_name` is a human label
// ("India"), not a publication. A scope is a render-time preference and must
// never reach `pubPrefs` (a W_PUB score term keyed by publication name) or the
// muted-publication hard-filter derivation below — either would silently match a
// real publication that happens to share the label. Both consumers below skip
// `scopeKind != null` rows explicitly, which is deliberately where the filtering
// lives: a narrower `getActiveNamedPublications()` import would put the guarantee
// somewhere the two call sites can't show it, and each of them needs to be
// independently correct anyway.

const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;

/** Publication-preference weight at or below which the publication counts as
 *  MUTED and is synthesized into a hard filter. Explicit "never show me
 *  this source" writes -1; the small margin absorbs float drift. */
const MUTED_PUBLICATION_WEIGHT = -0.9;
const isOnDeviceMode = () => _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.OnDevice;

// --- LlmPort adapters (for the inline sync path) ---------------------------

const cloudLlmPort = {
  batchComplete: calls => (0, _cloudComplete.cloudBatchComplete)(calls, 'scoring'),
  // Its only cloud caller is the subscription read.
  complete: req => (0, _cloudComplete.cloudComplete)({
    ...req,
    route: 'background'
  })
};

/** Local (on-device) port. Relevance goes through Kev (`relevanceScorer`), so only `complete`
 *  (the subscription read) is used; batchComplete is never reached. Plain text: the read asks for
 *  sentences or a bare SKIP, and a JSON grammar would quote that SKIP. */
const localLlmPort = {
  batchComplete: async calls => calls.map(c => ({
    id: c.id,
    output: '',
    error: 'on-device relevance runs through Kev'
  })),
  complete: req => (0, _completeLocal.completeLocal)({
    systemPrompt: req.systemPrompt,
    prompt: req.prompt,
    maxTokens: req.maxTokens,
    temperature: req.temperature
  })
};
function getScoringLlmPort() {
  return isOnDeviceMode() ? localLlmPort : cloudLlmPort;
}

// --- Persona snapshot ------------------------------------------------------

/**
 * Load the on-device persona snapshot the math engine scores against:
 *   - topicWeights: active topics × fact-level weight, clamped to [-1,1].
 *   - locations: all non-expired locations (expired travel windows dropped).
 *   - pubPrefs / softSuppressions: explicit-only preferences.
 *   - hardSuppressions: the ≥ HARD_SUPPRESSION_STRENGTH "not interested"
 *     filters, PLUS a derived publication filter per muted source.
 * NEVER leaves the device (privacy-lean).
 */
async function loadPersonaScoringContext(nowMs = Date.now()) {
  const [topics, locations, pubPrefRows, suppressions, factWeights, seenStoryIds, facts] = await Promise.all([(0, _topicService.getActive)(), (0, _locationService.getAll)(), (0, _publicationPreferenceService.getActive)(), (0, _suppressionService.getActive)(nowMs), (0, _articleSuggestionReads.getFactWeightById)(), (0, _storyImpressionService.getOpenedSeenSet)(), (0, _factService.getFacts)()]);
  const topicWeights = new Map();
  for (const t of topics) {
    const factWeight = t.factId ? factWeights.get(t.factId) ?? 1 : 1;
    topicWeights.set(t.id, {
      effectiveWeight: clamp(t.weight * factWeight, -1, 1),
      highPriority: t.highPriority,
      locationId: t.locationId ?? undefined
    });
  }
  const personaLocations = locations.filter(l => l.validUntil == null || l.validUntil > nowMs).map(l => (0, _personaContext.normalizeLocation)({
    id: l.id,
    city: l.city ?? undefined,
    region: l.region ?? undefined,
    countryCode: l.countryCode,
    role: l.role,
    weight: l.weight,
    validUntilMs: l.validUntil ?? undefined
  }));
  const pubPrefs = (0, _personaContext.buildPubPrefs)(pubPrefRows.map(p => ({
    publicationName: p.publicationName,
    weight: p.weight,
    scopeKind: p.scopeKind
  })));

  // Hard / soft partition — made HERE, exactly once, using the DB service's
  // HARD_SUPPRESSION_STRENGTH (0.8). Deliberately NOT a harness config
  // constant: the threshold is a property of how suppressions are stored, not a
  // tunable scoring weight.
  //   - soft (< 0.8) → capped score penalty (relevance.ts). UNCHANGED.
  //   - hard (≥ 0.8) → screened out entirely before any math/judge work.
  // `kind`/`value` are passed through as UNDEFINED when the column is null, so
  // the pure matcher owns the "null kind means keyword" default in one place.
  const softSuppressions = [];
  const hardSuppressions = [];
  for (const s of suppressions) {
    // ENTITY IS NEVER HARD, whatever its strength. Entity extraction measured
    // 68.8% correct, so an entity filter may lower a row's rank but must never
    // remove it (owner ruling). Deciding that HERE — at the one place the
    // hard/soft partition is made — is what makes the guarantee hold for every
    // consumer of this snapshot at once: the scoring stage, the E2EE pipeline
    // and `services/suppression-sweep`, none of which has to know the rule.
    // `suppression::canHardExclude` is the matching guard inside the engine.
    const isHard = s.strength >= _suppressionService.HARD_SUPPRESSION_STRENGTH && (0, _suppressionService.kindOf)(s) !== 'entity';
    const keywords = s.keywords ?? [];
    const pattern = s.pattern?.trim() || undefined;
    // A hard KEYWORD filter with no keywords would match nothing and silently
    // do nothing — fall back to its human pattern. Soft rows keep their exact
    // historical behaviour (empty keywords ⇒ no penalty), so this is hard-only.
    const effectiveKeywords = isHard && (0, _suppressionService.kindOf)(s) === 'keyword' && keywords.length === 0 && pattern ? [pattern] : keywords;
    const entry = {
      keywords: effectiveKeywords,
      strength: s.strength,
      kind: s.kind ?? undefined,
      value: s.value ? (0, _personaContext.normText)(s.value) : undefined,
      pattern
    };
    (isHard ? hardSuppressions : softSuppressions).push(entry);
  }

  // A muted publication is a DERIVED hard filter, never a duplicated row.
  // The Sources preferences screen stays the single manager — un-muting lifts
  // the filter on the next load with nothing to clean up.
  for (const p of pubPrefRows) {
    // Defence in depth — the loader above already excludes scope rows. A scope
    // is never a hard filter: there is no "mute every Indian source" promise
    // here, and its label would match a real publication by name if it were.
    if (p.scopeKind != null) continue;
    if (p.weight > MUTED_PUBLICATION_WEIGHT) continue;
    const value = (0, _personaContext.normText)(p.publicationName);
    if (!value) continue;
    hardSuppressions.push({
      keywords: [],
      strength: 1,
      kind: 'publication',
      value,
      pattern: p.publicationName
    });
  }
  const location = {
    factPlacesById: new Map(facts.map(f => [f.id, (0, _factPlaces.factPlaces)(f)])),
    readerCountries: new Set(personaLocations.map(l => (0, _locationRule.toAlpha2)(l.countryCode)).filter(c => !!c)),
    trackedTopicIds: new Set(topics.filter(t => t.provenance === 'tracked').map(t => t.id)),
    countriesInBloc: _placeService.countriesInBloc
  };
  const persona = {
    locations: personaLocations,
    location,
    pubPrefs,
    softSuppressions,
    hardSuppressions,
    // seen = OPENS ONLY (user decision): the P_SEEN demotion input is opened
    // rows exclusively — mere impressions never demote. Ids cover both
    // article_id and stable_cluster_id (the engine checks either).
    seenStoryIds
    // entityInterest stays unset — deliberate (entity weights are a later
    // change; entityComp reads 0 until an explicit "follow entity" signal exists).
  };
  return {
    persona,
    topicWeights
  };
}

// --- Stage candidate assembly ----------------------------------------------

/** Minimal StageCandidateRow for a candidate lacking persisted metadata (old
 *  rows / fallback path) → no geo/entities/event_type ⇒ backstop routing. */
function minimalStageRow(c) {
  return {
    id: c.id,
    titleEn: c.titleEn,
    descriptionEn: c.descriptionEn,
    publicationName: null,
    countryCode: c.countryCode,
    firstPubDateMs: null,
    maxClusterSize: null,
    eventType: null,
    category: null,
    geoTagsJson: null,
    entitiesJson: null,
    matchedTopicsJson: null,
    headlineScope: null,
    stableClusterId: null
  };
}

/** Map ScoringCandidate[] → StageCandidate[]: the rich metadata drives the math
 *  input, the ScoringCandidate itself is the `legacy` LLM-scoring payload.
 *
 *  THE ENGINE NOW SEES THE SERVER'S TAGS. `applyArticleTagPolicy` used to sit
 *  here and blank `geoTags` / `entities` / `eventType` unless
 *  `USE_ARTICLE_TAGS` was on. Both are deleted. The blanking was there to stop
 *  a tagged row routing onto the judge path; the judge is gone, so all it did
 *  was make the user's `event_type` / `entity` / `place` "not interested"
 *  filters — which the feedback surface CREATES — unable to match anything.
 *  See the header of `scoring-engine/relevance.ts` for what unblanking also
 *  turns on inside the math. */
function buildStageCandidates(candidates, topicWeights) {
  return candidates.map(c => ({
    input: (0, _articleSuggestionMappers.buildStageCandidateInput)(c.meta ?? minimalStageRow(c), topicWeights),
    legacy: c
  }));
}

/** The fact bank: plain statements for Kev; for the cloud prompts, place-named lines that end with
 *  the day each fact was saved, so a trip can end. Every scoring path reads it from here. */
async function loadAllFactStatements(withPlaces = true) {
  const facts = await (0, _factService.getFacts)();
  return facts.filter(f => typeof f.statement === 'string' && f.statement.trim().length > 0).map(f => withPlaces ? (0, _scoring.withAddedDate)((0, _factPlaces.factLineWithPlaces)(f), f.createdAt ? Date.parse(f.createdAt) : null) : f.statement);
}

/**
 * Layer the persisted `scoringEngineOverrides` (the self-tuning deltas the
 * calibration loop produced) over the base ScoringEngineConfig. Loaded once per
 * scoring batch. When there are no overrides, applyScoringOverrides returns the
 * SAME base reference, so we hand back DEFAULT_HARNESS_CONFIG untouched (no
 * allocation). Any read failure fail-opens to the base config.
 *
 * RELEVANCE v4 is controlled only by the harness defaults: its two
 * article-tag features (`legacyTagPromptEnabled`, `legacyTagReasonGateEnabled`)
 * in DEFAULT_HARNESS_CONFIG (lib/news-harness/core/config.ts), flipped
 * together by an OTA, currently off. There is no user setting and nothing
 * stored on the device can turn it on.
 */
async function effectiveHarnessConfig() {
  try {
    // With no overrides this is DEFAULT_HARNESS_CONFIG ITSELF (identity is
    // asserted by stage-scoring.test.ts): no allocation per scoring batch.
    const base = _config.DEFAULT_HARNESS_CONFIG;
    const overrides = await (0, _calibrationService.getScoringOverrides)();
    const eng = (0, _calibration.applyScoringOverrides)(base.scoringEngine, overrides);
    return eng === base.scoringEngine ? base : {
      ...base,
      scoringEngine: eng
    };
  } catch {
    return _config.DEFAULT_HARNESS_CONFIG;
  }
}
/**
 * Run ONLY the deterministic math (no LLM) over the candidates — used by the
 * E2EE pipeline at SUBMIT time, whose LLM call is a deferred encrypted job.
 * Its real product is the HARD "not interested" screen plus the persisted
 * math/components audit; the scores fail-open if the LLM call never lands.
 */
async function computeMathStage(candidates, nowMs = Date.now()) {
  const [{
    persona,
    topicWeights
  }, config] = await Promise.all([loadPersonaScoringContext(nowMs), effectiveHarnessConfig()]);
  const allStage = buildStageCandidates(candidates, topicWeights);

  // HARD "not interested" screen — the E2EE path never enters computeAndScore,
  // so this is its own convergence point for the same shared matcher. A
  // top-headline row that matches a hard filter lands in `exempted`, stays in
  // `stage`, and is demoted by computeRelevance rather than removed.
  const {
    excluded: excludedValueById,
    exempted: exemptedValueById
  } = (0, _suppression.screenHardSuppressionsDetailed)(allStage.map(c => c.input), persona.hardSuppressions);
  const excludedIds = new Set(excludedValueById.keys());
  const screened = excludedIds.size > 0 ? allStage.filter(c => !excludedIds.has(c.input.id)) : allStage;
  // The location rule, same as computeAndScore's step 0b: caught rows leave the stage.
  const locationCaughtIds = persona.location ? (0, _locationRule.screenLocationRule)(screened, persona.location) : new Set();
  const computedScoreMap = new Map();
  const componentsMap = new Map();
  const modeMap = new Map();
  for (const c of screened) {
    const r = (0, _relevance.computeRelevance)(c.input, persona, config.scoringEngine, nowMs);
    const caught = locationCaughtIds.has(c.input.id);
    computedScoreMap.set(c.input.id, r.score);
    componentsMap.set(c.input.id, caught ? {
      ...r.components,
      locationCaught: true
    } : r.components);
    modeMap.set(c.input.id, r.mode);
  }
  const stage = locationCaughtIds.size > 0 ? screened.filter(c => !locationCaughtIds.has(c.input.id)) : screened;
  return {
    persona,
    stage,
    computedScoreMap,
    componentsMap,
    modeMap,
    excludedIds,
    excludedValueById,
    exemptedValueById,
    locationCaughtIds
  };
}

/**
 * Sync inline path: hard-screen, compute the math for every candidate, then
 * score them all through the legacy tiered LLM call. The LLM round-trip happens
 * INLINE via the LlmPort (this is the synchronous scoring-service orchestrator;
 * the E2EE pipeline defers the LLM call and so does NOT use this).
 */
async function computeAndScoreForCandidates(candidates, opts) {
  // Cloud prompts name each fact's places; Kev (on-device) keeps plain statements. The
  // candidates' relatedFacts carry `places` from the read; Kev reads `statement` only.
  const onDevice = isOnDeviceMode();
  const [{
    persona,
    topicWeights
  }, factStatements, config] = await Promise.all([loadPersonaScoringContext(opts?.nowMs), loadAllFactStatements(!onDevice), effectiveHarnessConfig()]);
  const stage = buildStageCandidates(candidates, topicWeights);
  return (0, _runStage.computeAndScore)(stage, persona, onDevice ? localLlmPort : cloudLlmPort, config, {
    relevanceScorer: onDevice ? _kevRelevance.scoreWithKev : undefined,
    nowMs: opts?.nowMs,
    factStatements,
    // The day the reader is living in: with each fact's added date, it lets a trip end.
    today: onDevice ? undefined : (0, _scoring.localDay)(opts?.nowMs ?? Date.now()),
    logger: _loggerAdapter.appHarnessLogger,
    skipLlm: opts?.skipLlm
  });
}

/**
 * A fact's places changed: send the rows the location rule caught for it back to
 * `unscored`, so the next scoring pass judges them under the new places. Rows the
 * reader opened (`already_read`) are left alone by the writer. Returns how many.
 * Persona calls this after `setFactPlaces`.
 */
async function rescoreLocationCaught(factId) {
  const links = await _database.default.get('article_suggestion_facts').query(_watermelondb.Q.where('fact_id', factId)).fetch();
  const ids = [...new Set(links.map(l => l.articleSuggestionId))];
  if (ids.length === 0) return 0;
  const rows = await _database.default.get('article_suggestions').query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(ids)), _watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.Complete)).fetch();
  const caught = rows.filter(r => {
    try {
      return JSON.parse(r.scoreComponentsJson ?? 'null')?.locationCaught === true;
    } catch {
      return false;
    }
  }).map(r => r.id);
  await (0, _articleSuggestionScoringWrites.batchResetToUnscored)(caught);
  return caught.length;
}