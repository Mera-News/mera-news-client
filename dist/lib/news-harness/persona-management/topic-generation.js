"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RELATIONAL_SUBJECT_RE = void 0;
exports.buildBaseUserPrompt = buildBaseUserPrompt;
exports.buildCloudBatchCallsForFact = buildCloudBatchCallsForFact;
exports.generateTopicsForFactsBatch = generateTopicsForFactsBatch;
exports.mergeRealOutputsForFact = mergeRealOutputsForFact;
exports.mergeTopicsAppend = mergeTopicsAppend;
exports.parseTopicsFromOutput = parseTopicsFromOutput;
exports.planLlmTopicRows = planLlmTopicRows;
exports.resolveUserLocationFact = resolveUserLocationFact;
exports.splitCount = splitCount;
var _prompts = require("../prompts/prompts");
var _normalizeKey = require("../../algorithms/normalize-key");
var _questionnaireData = require("../prompts/questionnaire-data");
var _config = require("../core/config");
var _ports = require("../core/ports");
// news-harness — pure topic-generation builders + a port-based batch flow.
//
// The pure builders (buildBaseUserPrompt, splitCount, buildCloudBatchCallsForFact,
// mergeRealOutputsForFact, mergeTopicsAppend, parseTopicsFromOutput) were moved
// verbatim from lib/mera-protocol/topic-generation-service.ts. The old file now
// re-exports them (injecting the app logger / prompt constants at the seam so its
// frozen tests keep passing).
//
// generateTopicsForFactsBatch reproduces the cloud batch flow that used to live
// in lib/chat-tools/tool-handlers.ts::batchGenerateTopics, but through ports so
// it never touches WatermelonDB, the cloud client, or the floating-chat store.

const TOPIC_CFG = _config.DEFAULT_HARNESS_CONFIG.topicGen;
const DEFAULT_TOTAL_CLOUD = TOPIC_CFG.totalCloud;

/** Optional system-prompt override so the old-path wrapper can inject the
 *  prompt constants from its (test-mockable) `./prompts` import. Defaults to the
 *  real harness prompts for the production batch flow. */

function buildBaseUserPrompt(inputs, includeOthers) {
  let prompt = `Fact: "${(0, _prompts.asUntrusted)(inputs.factStatement)}"`;
  if (inputs.factPlace) {
    prompt += `\nFact place: ${(0, _prompts.asUntrusted)(inputs.factPlace)}`;
  }
  if (inputs.userLocation) {
    prompt += `\nUser location: ${(0, _prompts.asUntrusted)(inputs.userLocation)}`;
  }
  if (includeOthers && inputs.otherFacts.length > 0) {
    prompt += `\nOther user facts:\n${inputs.otherFacts.map(s => `- ${(0, _prompts.asUntrusted)(s)}`).join('\n')}`;
  }
  if (inputs.excludeTopics && inputs.excludeTopics.length > 0) {
    prompt += `\nDo NOT repeat these existing topics:\n${inputs.excludeTopics.map(s => `- ${(0, _prompts.asUntrusted)(s)}`).join('\n')}`;
  }
  return prompt;
}
function splitCount(total, hasOthers) {
  if (!hasOthers) return {
    factOnly: total,
    combo: 0
  };
  // 2026-07-16: bias ~60/40 toward fact-only. Fact-only anchored topics
  // (home/city/family) were the best feed-worthy performers in the prod
  // baseline, while the combo path produced most of the wasted-quota noise
  // (country-level fact-bleed, near-synonym variants). At total=10 → 6/4.
  const combo = Math.floor(total * 0.4);
  const factOnly = total - combo;
  return {
    factOnly,
    combo
  };
}

/**
 * Build the up-to-2 real BatchCall entries for one fact: factOnly (always) +
 * combo (when other facts exist).
 */
function buildCloudBatchCallsForFact(inputs, idPrefix, systemPrompts = {
  factOnly: _prompts.CLOUD_TOPIC_GENERATION_SYSTEM_PROMPT,
  combo: _prompts.CLOUD_FACT_COMBO_TOPIC_GENERATION_SYSTEM_PROMPT
}) {
  const total = inputs.totalCount ?? DEFAULT_TOTAL_CLOUD;
  const hasOthers = inputs.otherFacts.length > 0;
  const {
    factOnly: factOnlyCount,
    combo: comboCount
  } = splitCount(total, hasOthers);
  // Thinking is OFF on both halves — `enableThinking` is omitted, and
  // cloudComplete's batch path sends `enable_thinking: false` for an absent flag.
  //
  // It was ON here on the argument that judging a candidate topic is
  // reasoning work. Measured against Qwen3.6-35B-A3B, that cost far more than it
  // bought: the trace runs ~2000+ tokens against a ~55-token answer, so it ate
  // the whole 2048 budget and `content` came back EMPTY on 8 of 10 probe runs,
  // at 8-10s each. Thinking off is 0.8-1.0s with a valid answer every time.
  //
  // Do NOT re-enable this without a fresh A/B. The contamination it was meant to fix
  // ("Amsterdam cricket festival music tech") is handled elsewhere: the ceiling
  // wording below plus the entity cap and negative examples in the system
  // prompt — which is independent of thinking and stays. There is also no
  // cheaper middle setting: `reasoning_effort: 'low'` yields the same trace with
  // worse variance, and `thinking_budget` is silently ignored by the template.
  const maxTokens = Math.max(TOPIC_CFG.cloudMaxTokens, total * 30);
  const calls = [];
  if (factOnlyCount > 0) {
    calls.push({
      id: `${idPrefix}:factOnly`,
      system: systemPrompts.factOnly,
      prompt: `${buildBaseUserPrompt(inputs, false)}\nGenerate ${factOnlyCount} topics.`,
      temperature: 0.3,
      maxTokens
    });
  }
  if (comboCount > 0 && hasOthers) {
    calls.push({
      id: `${idPrefix}:combo`,
      system: systemPrompts.combo,
      // "at most" — a CEILING, not a quota. The combo prompt used to be told an
      // exact count while ALSO being offered `[]` as an escape, and the exact
      // count won: with 4 slots and no genuine cricket/AI/music overlap the
      // model padded with "Amsterdam cricket festival music tech". The system
      // prompt now says ceiling everywhere; this is the other half of that fix.
      prompt: `${buildBaseUserPrompt(inputs, true)}\nGenerate at most ${comboCount} topics — fewer is correct.`,
      temperature: 0.3,
      maxTokens
    });
  }
  return calls;
}

/**
 * Merge the raw factOnly + combo outputs for a single fact into a deduped
 * real-topic list. Order: factOnly first, then combo, deduped case-insensitively.
 */
function mergeRealOutputsForFact(factOnlyOutput, comboOutput, factStatement, logger = _ports.NOOP_LOGGER) {
  const seen = new Set();
  const out = [];
  for (const raw of [factOnlyOutput, comboOutput]) {
    if (!raw) continue;
    for (const t of parseTopicsFromOutput(raw, factStatement, logger)) {
      const key = t.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * Append newly generated topics onto an existing list, deduped
 * case-insensitively (existing order preserved, new topics appended).
 */
function mergeTopicsAppend(existing, incoming) {
  const seen = new Set(existing.map(t => t.toLowerCase().trim()));
  const out = [...existing];
  for (const t of incoming) {
    const key = t.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LLM topic-row minting plan (closes the "metadata.topics never reach
// the feed" gap). PURE: given the normalized texts already owned by a fact and
// the freshly generated topic texts, returns the rows to create (deduped vs the
// existing rows AND vs each other). The RN caller (topic-service) turns each
// entry into a `topics` row. Kept here so the dedupe is unit-tested without a DB.
// ---------------------------------------------------------------------------

/**
 * Plan the NEW topic rows to mint for a fact. Skips any incoming text whose
 * normalized form already exists on the fact (so re-generation / "generate more"
 * never duplicates) or repeats earlier in the same incoming batch. Empty texts
 * are dropped. Order follows the incoming list.
 */
function planLlmTopicRows(existingNormalizedTexts, incomingTexts,
// Default normalize (normalizeKey) MUST stay byte-identical to
// lib/database/services/topic-service.ts::normalizeTopicText so a text minted
// here dedupes against a stored row's `normalized_text`. The RN caller passes
// its own normalizeTopicText to guarantee the production path never drifts.
normalize = _normalizeKey.normalizeKey) {
  const seen = new Set();
  for (const n of existingNormalizedTexts) seen.add(n);
  const out = [];
  for (const raw of incomingTexts) {
    const text = raw.trim();
    if (!text) continue;
    const normalizedText = normalize(text);
    if (!normalizedText || seen.has(normalizedText)) continue;
    seen.add(normalizedText);
    out.push({
      text,
      normalizedText
    });
  }
  return out;
}
function parseTopicsFromOutput(output, factStatement, logger = _ports.NOOP_LOGGER) {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed.filter(item => typeof item === 'string' && item.trim().length > 0).map(s => s.trim()).slice(0, 20);
    }
  } catch {
    const arrayMatch = output.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      try {
        const extracted = JSON.parse(arrayMatch[0]);
        if (Array.isArray(extracted)) {
          return extracted.filter(item => typeof item === 'string' && item.trim().length > 0).map(s => s.trim()).slice(0, 20);
        }
      } catch {
        // Fall through
      }
    }
  }

  // Sizes only: the output and the fact are the person's.
  logger.warn('Topic generation: failed to parse output', {
    outputChars: output.length,
    factChars: factStatement.length
  });
  return [];
}

// ---------------------------------------------------------------------------
// Port-based batch flow (reproduces tool-handlers::batchGenerateTopics)
// ---------------------------------------------------------------------------

/** Fact ids whose questionnaire attribute marks them as the USER's own location. */
const USER_OWN_LOCATION_ATTR_IDS = new Set(['q1_location', 'q4_neighborhood']);

/** Tier-3 shapes for "the user currently lives here", stated in the fact text. */
const RESIDENCE_STATEMENT_RE = /\b(lives?|living|residing|resides?|based|settled|relocated|moved)\s+(in|to)\b/i;

/**
 * Third parties whose presence somewhere is NOT the user's own location. Topic
 * generation already treats these as branch (a-2) — anchored to that place and
 * deliberately NOT laddered — so promoting one to `userLocation` would anchor
 * every unanchored personal fact in the persona to, say, the user's parents'
 * town. Tier 3 is a text heuristic, so it needs this explicit veto.
 */
const RELATIONAL_SUBJECT_RE = exports.RELATIONAL_SUBJECT_RE = /\b(parents?|mother|father|mom|mum|dad|family|in-?laws?|sibling|brother|sister|partner|spouse|wife|husband|girlfriend|boyfriend|friends?|colleagues?|son|daughter|children|kids|grandparents?|grandmother|grandfather|relatives?|cousins?)\b/i;

/** The minimum shape this resolver needs — deliberately not the full Fact. */

/**
 * Resolve the fact that states where the user CURRENTLY LIVES — the anchor for
 * topic-generation rule (b).
 *
 * Three tiers, most explicit first:
 *   1. The questionnaire attribute maps to `q1_location` / `q4_neighborhood`.
 *   2. The attribute merely LOOKS like a location key ("location: …",
 *      "residence: …", "neighborhood: …", "home: …") — `isLocationAttribute`.
 *   3. The STATEMENT says the user lives somewhere, and names no third party.
 *
 * Tier 1 alone was the whole implementation, and it is why the reported
 * expat-from-India persona got unanchored topics: the chat agent mints its own
 * attribute strings, and any string that is not byte-identical to the two
 * canonical texts resolved to `null`. With no user location, rule (b) cannot
 * fire and every personal fact falls through to (c) "unanchored".
 *
 * Tiers are evaluated in order across ALL facts, so a fact with the canonical
 * attribute always beats a text-matched one no matter what order they are in.
 */
function resolveUserLocationFact(facts, options = {}) {
  const candidates = options.excludeFactId ? facts.filter(f => f.id !== options.excludeFactId) : facts;
  const attrTextToId = (0, _questionnaireData.buildAttributeTextToIdMap)();
  const tier1 = candidates.find(f => {
    if (!f.questionnaireAttribute) return false;
    const attrId = attrTextToId.get(f.questionnaireAttribute);
    return attrId !== undefined && USER_OWN_LOCATION_ATTR_IDS.has(attrId);
  });
  if (tier1) return tier1;
  const tier2 = candidates.find(f => !!f.questionnaireAttribute && (0, _questionnaireData.isLocationAttribute)(f.questionnaireAttribute));
  if (tier2) return tier2;
  return candidates.find(f => RESIDENCE_STATEMENT_RE.test(f.statement) && !RELATIONAL_SUBJECT_RE.test(f.statement));
}

/**
 * DEPRECATED: no app path calls this any more; every topic run is a
 * queued, isolated job through the skill core. Kept only because
 * harness-local/scripts/test-news-harness-persona-management.ts imports it;
 * delete together with that script's migration.
 *
 * Batch-generates real topics for all facts in ONE cloud API call. Each fact
 * contributes up to 2 BatchCall entries (fact-only + combo). Generated topics are
 * saved to fact.metadata.topics (or fact.metadata.topicGenError) via the persona
 * store port. Does NOT notify the chat store — the caller does that.
 */
async function generateTopicsForFactsBatch(ports, factEntries, config = TOPIC_CFG) {
  const logger = ports.logger ?? _ports.NOOP_LOGGER;
  const systemPrompts = {
    factOnly: config.factOnlySystemPrompt,
    combo: config.comboSystemPrompt
  };
  const buildCalls = ports.buildCalls ?? ((inputs, idPrefix) => buildCloudBatchCallsForFact(inputs, idPrefix, systemPrompts));
  logger.debug('[topic-gen-batch] starting', {
    factCount: factEntries.length
  });
  const allFacts = await ports.personaStore.getFacts();
  const userLocation = resolveUserLocationFact(allFacts);
  const realCalls = [];
  for (const entry of factEntries) {
    const otherFacts = allFacts.filter(f => f.id !== entry.id && f.id !== userLocation?.id).map(f => f.statement);
    realCalls.push(...buildCalls({
      factStatement: entry.statement,
      userLocation: userLocation?.statement ?? null,
      otherFacts
    }, entry.id));
  }
  logger.debug('[topic-gen-batch] calling batch-infer', {
    callCount: realCalls.length,
    factCount: factEntries.length
  });
  let realResults;
  try {
    realResults = await ports.llm.batchComplete(realCalls);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn('[topic-gen-batch] cloud batch threw', {
      error: errMsg
    });
    for (const entry of factEntries) {
      await ports.personaStore.updateFactMetadata(entry.id, {
        topicGenError: [errMsg]
      });
    }
    return;
  }
  logger.debug('[topic-gen-batch] response', {
    resultCount: realResults.length
  });

  // Re-key results into per-fact (factOnly, combo) buckets.

  const realOutputsByFactId = new Map();
  for (const result of realResults) {
    const sep = result.id.lastIndexOf(':');
    if (sep === -1) {
      logger.warn('[topic-gen-batch] unexpected result id', {
        id: result.id
      });
      continue;
    }
    const factId = result.id.slice(0, sep);
    const half = result.id.slice(sep + 1);
    const bucket = realOutputsByFactId.get(factId) ?? {
      factOnly: null,
      combo: null,
      halfErrors: []
    };
    if (result.error) {
      bucket.halfErrors.push(`${half}: ${result.error}`);
      logger.warn('[topic-gen-batch] half failed', {
        factId,
        half,
        error: result.error
      });
    } else {
      bucket[half] = result.output;
    }
    realOutputsByFactId.set(factId, bucket);
  }

  // Merge real topics per fact.
  for (const entry of factEntries) {
    const bucket = realOutputsByFactId.get(entry.id);
    if (!bucket) {
      await ports.personaStore.updateFactMetadata(entry.id, {
        topicGenError: ['No topic-gen result returned']
      });
      continue;
    }
    const real = mergeRealOutputsForFact(bucket.factOnly, bucket.combo, entry.statement, logger);
    if (real.length === 0) {
      const errMsg = bucket.halfErrors.length > 0 ? bucket.halfErrors.join('; ') : 'Topic generation returned no usable topics';
      logger.warn('[topic-gen-batch] no topics parsed', {
        factId: entry.id
      });
      await ports.personaStore.updateFactMetadata(entry.id, {
        topicGenError: [errMsg]
      });
      continue;
    }
    await ports.personaStore.updateFactMetadata(entry.id, {
      topics: real
    });
  }
  logger.debug('[topic-gen-batch] done');
}