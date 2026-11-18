"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TOPICS_REVIEWED_AT_KEY = void 0;
exports.hasReviewMarker = hasReviewMarker;
exports.resolveTopicPlan = resolveTopicPlan;
exports.unresolvedFactIds = unresolvedFactIds;
// Topic-plan resolution — the ONE place that decides whether a
// "Topics I'll track" card has been acted on.
//
// WHY THIS IS NOT JUST THE STORE MAP. Since the topic-plan card, an unresolved card BLOCKS the
// chat input and the onboarding Next button. `settledTopicPlans` /
// `discardedTopicPlans` in floating-chat-store are in-memory only (the store
// says so explicitly), while the cards themselves re-derive from a PERSISTED
// `saveExtractedFacts` tool result (deriveThreadItems → savedFactsWithIds). So
// after a relaunch every previously-acted-on card comes back "unsettled" — and
// gating on the store alone would re-block the user against cards whose topics
// are already saved, with no way out.
//
// The durable half:
//   SAVE    → `metadata.topicsReviewedAt` on the fact (additive JSON, no schema
//             migration — the schema version is owned elsewhere).
//   DISCARD → the fact row is DELETED, so its absence IS the marker. A card
//             whose fact no longer exists is resolved by construction.
//
// UNKNOWN fails open. `getFacts()` is async and can fail; treating "not loaded
// yet" or "read failed" as unresolved would block the input during every mount
// and permanently on a read error. Only a CONFIRMED present-and-unreviewed fact
// blocks.

/** The `metadata` key written on Save. `Fact.metadata` is `Record<string, string[]>`,
 *  so the value is a single-element ISO-timestamp list (same shape as `topicGenError`). */
const TOPICS_REVIEWED_AT_KEY = exports.TOPICS_REVIEWED_AT_KEY = 'topicsReviewedAt';
function hasReviewMarker(fact) {
  const raw = fact?.metadata?.[TOPICS_REVIEWED_AT_KEY];
  return Array.isArray(raw) ? raw.length > 0 : false;
}
function resolveTopicPlan({
  factId,
  settled,
  discarded,
  factsLoaded,
  fact
}) {
  // Session-local wins: it is the freshest signal and it makes the card react
  // to a tap without waiting for the next facts read.
  if (discarded[factId] === true) return 'discarded';
  if (settled[factId] === true) return 'saved';
  if (!factsLoaded) return 'unknown';
  if (!fact) return 'discarded';
  return hasReviewMarker(fact) ? 'saved' : 'unresolved';
}

/** The subset of `factIds` that must be acted on before the user may continue. */
function unresolvedFactIds(factIds, ctx) {
  return factIds.filter(id => resolveTopicPlan({
    factId: id,
    settled: ctx.settled,
    discarded: ctx.discarded,
    factsLoaded: ctx.factsLoaded,
    fact: ctx.factsById.get(id)
  }) === 'unresolved');
}