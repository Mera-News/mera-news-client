"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SANITY_MAX_TOPICS_PER_SWEEP = exports.SANITY_MAX_TOKENS = exports.SANITY_BATCH_SIZE = void 0;
exports.decodeSanityVerdicts = decodeSanityVerdicts;
exports.planSanityBatches = planSanityBatches;
exports.renderSanityPrompt = renderSanityPrompt;
var _prompts = require("../prompts/prompts");
var _ports = require("../core/ports");
// news-harness — topic-sanity planning + verdict decoding (PURE, RN-free).
//
// The weekly hygiene sweep asks an LLM whether each already-minted
// topic genuinely belongs to the fact that owns it, so the combo-prompt
// contamination ("Amsterdam cricket festival music tech") can be cleaned up
// rather than only prevented. Everything that can be decided without a database
// or a network call lives here: which topics to audit, how to batch them, how to
// render the prompt, and how to decode the verdicts.
//
// The RN adapter (lib/database/services/topic-sanity-service.ts) supplies live
// rows, issues the batch call, and turns the verdicts into hygiene proposals.

/** Topics per BatchCall. 15 keeps the reasoning trace comfortably inside
 *  SANITY_MAX_TOKENS while amortising the system prompt across enough items. */
const SANITY_BATCH_SIZE = exports.SANITY_BATCH_SIZE = 15;

/** Per-sweep audit ceiling. Doing double duty: it bounds cost AND keeps the
 *  whole audit inside the sweep's race window (4 batches, one HTTP round trip).
 *  Raising it means revisiting both. */
const SANITY_MAX_TOPICS_PER_SWEEP = exports.SANITY_MAX_TOPICS_PER_SWEEP = 60;

/** Output budget per sanity BatchCall. Thinking is ON, so the reasoning trace
 *  shares this with the answer: ~15 verdicts ≈ 210 tokens, leaving ~2.8k for the
 *  trace. Sized deliberately rather than reusing the topic-gen budget. */
const SANITY_MAX_TOKENS = exports.SANITY_MAX_TOKENS = 3072;

/** A topic the sweep may audit, projected free of WatermelonDB. */

/**
 * Choose which topics to audit this sweep and shape them into batch calls.
 *
 * Selection is `createdAtMs > cursor`, oldest-first, capped. Sound because a
 * topic's createdAt is set at mint and its text never changes afterwards, so
 * nothing can appear BEHIND the cursor — a monotonic cursor is equivalent to a
 * per-row "audited" flag for every row not yet seen, without a schema change.
 * The cap never cuts a run of topics sharing one createdAtMs (one createTopics
 * call stamps them alike): the cursor would move past the tail. It stops before
 * the run, or takes all of it when the run alone exceeds the cap.
 *
 * Topics whose owning fact is missing are skipped (nothing to judge them
 * against). Exclusions that depend on provenance or tracked-story binding are
 * applied by the caller before this point.
 */
function planSanityBatches(topics, facts, cursorMs, opts = {}) {
  const batchSize = opts.batchSize ?? SANITY_BATCH_SIZE;
  const maxTopics = opts.maxTopics ?? SANITY_MAX_TOPICS_PER_SWEEP;
  const statementById = new Map(facts.map(f => [f.id, f.statement]));
  const sorted = topics.filter(t => t.createdAtMs > cursorMs && statementById.has(t.factId)).sort((a, b) => a.createdAtMs !== b.createdAtMs ? a.createdAtMs - b.createdAtMs : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  let end = Math.min(maxTopics, sorted.length);
  if (end > 0 && end < sorted.length && sorted[end - 1].createdAtMs === sorted[end].createdAtMs) {
    const ms = sorted[end].createdAtMs;
    let start = end;
    while (start > 0 && sorted[start - 1].createdAtMs === ms) start--;
    if (start > 0) end = start;else while (end < sorted.length && sorted[end].createdAtMs === ms) end++;
  }
  const eligible = sorted.slice(0, end);
  const calls = [];
  const topicIdsByCallId = new Map();
  let maxCreatedAtMs = 0;
  for (let i = 0; i < eligible.length; i += batchSize) {
    const chunk = eligible.slice(i, i + batchSize);
    const id = `sanity:${i / batchSize}`;
    calls.push({
      id,
      system: _prompts.TOPIC_SANITY_SYSTEM_PROMPT,
      prompt: renderSanityPrompt(chunk, statementById),
      temperature: 0.1,
      maxTokens: SANITY_MAX_TOKENS,
      enableThinking: true
    });
    topicIdsByCallId.set(id, chunk.map(t => t.id));
    for (const t of chunk) {
      if (t.createdAtMs > maxCreatedAtMs) maxCreatedAtMs = t.createdAtMs;
    }
  }
  return {
    calls,
    topicIdsByCallId,
    maxCreatedAtMs
  };
}

/** Group topics under their fact so the model sees each verdict in the only
 *  context that makes it judgeable, while keeping ONE flat 1-based numbering. */
function renderSanityPrompt(chunk, statementById) {
  const byFact = new Map();
  chunk.forEach((t, idx) => {
    const list = byFact.get(t.factId) ?? [];
    list.push({
      text: t.text,
      n: idx + 1
    });
    byFact.set(t.factId, list);
  });
  const blocks = [];
  for (const [factId, items] of byFact) {
    blocks.push(`Fact: "${statementById.get(factId) ?? ''}"`);
    for (const it of items) blocks.push(`${it.n}. "${it.text}"`);
  }
  blocks.push('', `Return exactly ${chunk.length} verdicts.`);
  return blocks.join('\n');
}

/**
 * Decode one call's verdict array into the topic ids judged INCOHERENT.
 *
 * Fail-safe by construction: anything unparseable, out of range, or simply
 * missing leaves its topic untouched (treated as ok). A malformed response can
 * therefore never cause a retire proposal — only a missed one, which the next
 * sweep can still catch.
 */
function decodeSanityVerdicts(output, topicIds, logger = _ports.NOOP_LOGGER) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    const m = output.match(/\[[\s\S]*\]/);
    if (!m) {
      logger.warn('[topic-sanity] unparseable verdict output', {
        output
      });
      return [];
    }
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      logger.warn('[topic-sanity] unparseable verdict array', {
        output
      });
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    logger.warn('[topic-sanity] verdicts were not an array', {
      output
    });
    return [];
  }
  const flagged = [];
  const seen = new Set();
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const {
      i,
      ok
    } = item;
    if (typeof i !== 'number' || !Number.isInteger(i)) continue;
    if (ok !== false) continue; // only an explicit false flags anything
    const idx = i - 1; // prompt numbering is 1-based
    if (idx < 0 || idx >= topicIds.length) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    flagged.push(topicIds[idx]);
  }
  return flagged;
}