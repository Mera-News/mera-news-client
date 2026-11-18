"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.generateAndReplace = generateAndReplace;
exports.regenerateTopicsForFact = regenerateTopicsForFact;
var _logger = _interopRequireDefault(require("../../logger"));
var _cloudComplete = require("../../llm/cloudComplete");
var _loggerAdapter = require("../../news-harness-app/logger-adapter");
var _topicTopup = require("../../news-harness/persona-management/topic-topup");
var _topicGeneration = require("../../news-harness/persona-management/topic-generation");
var _factService = require("./fact-service");
var _factPlaces = require("../../news-harness/persona-management/fact-places");
var _graphqlTypes = require("../../generated/graphql-types");
var _topicService = require("./topic-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Topic Replacement Service — the "replace, don't just delete" half of the
// topic-sanity pass.
//
// When the user accepts an `incoherent_topics` proposal, the contaminated topics
// must not simply vanish: the fact would lose coverage it never asked to lose.
// So replacements are generated FIRST, and only once they are in hand are the
// bad topics retired — in the same database write.
//
// Reuses J's combo-only builder rather than a third generation path, so the
// scheduled top-up and this one-shot replacement can never drift apart in
// prompt, budget, dedupe, or provenance.

const FAILED = {
  ok: false,
  minted: 0,
  retired: 0,
  floorHeld: false
};
function toEpochMs(iso) {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Generate replacements for `factId`, then retire `retireTopicIds` — atomically.
 *
 * Ordering is the safety property, not an implementation detail:
 *   1. generate (network). ANY failure here returns ok:false having changed
 *      NOTHING — no mint, no retire, no metadata write. The caller leaves the
 *      proposal pending and the user is exactly where they started.
 *   2. plan rows against the GLOBAL exclusion set (every status, every
 *      provenance) so a replacement can never collide with a `tracked` topic's
 *      text — that collision would make a followed story's articles metered
 *      again, which is live prod behaviour now, not a hypothetical.
 *   3. mint + retire in ONE write (see replaceTopicsForFact).
 *
 * Never throws.
 */
async function generateAndReplace(factId, fillTo, retireTopicIds, /** Checked after generation, before anything commits; false discards the result. */
shouldCommit) {
  try {
    const [facts, topicRows, globalTexts] = await Promise.all([(0, _factService.getFacts)(), (0, _topicService.getTopupTopicSnapshots)(), (0, _topicService.getAllNormalizedTexts)()]);
    const target = facts.find(f => f.id === factId);
    if (!target) return FAILED;
    const retiring = new Set(retireTopicIds);
    const [candidate] = (0, _topicTopup.selectTopupCandidates)(facts.map(f => ({
      id: f.id,
      // The line carries the fact's places, so a place change changes the prompt (unchanged without places).
      statement: (0, _factPlaces.factLineWithPlaces)(f),
      // Fact.createdAt is an ISO string (mera-protocol-toolkit types), not a
      // Date — unlike the WatermelonDB models. NaN would poison the ordering,
      // so an unparseable value degrades to 0 (treated as oldest).
      createdAtMs: toEpochMs(f.createdAt)
    })),
    // `fillTo` is the active count BEFORE the retire, so the topics about to
    // go must not count as active here, or the headroom is zero and nothing
    // is ever requested.
    topicRows.map(t => retiring.has(t.id) ? {
      ...t,
      isActive: false
    } : t), {
      mode: 'fillTo',
      fillTargets: new Map([[factId, fillTo]]),
      maxFacts: 1,
      // The proposal already decided how much coverage to restore; the
      // per-sweep per-fact cap governs the scheduled path, not this one.
      maxTopicsPerFact: Math.max(1, fillTo)
    });

    // No candidate ⇒ nothing to generate (already at target, or no supporting
    // facts). That is NOT a failure: retiring is still safe because the fact
    // keeps whatever it has, and the floor in replaceTopicsForFact protects it.
    if (!candidate) {
      const res = await (0, _topicService.replaceTopicsForFact)(factId, [], retireTopicIds);
      return summarise(res);
    }
    const call = (0, _topicTopup.buildComboOnlyBatchCall)(candidate);
    const [result] = await (0, _cloudComplete.cloudBatchComplete)([call]);

    // Step 1 failure ⇒ change nothing at all.
    if (result.error) {
      _logger.default.warn('[topic-replacement] generation failed — nothing changed', {
        factId,
        error: result.error
      });
      return FAILED;
    }
    const texts = (0, _topicGeneration.parseTopicsFromOutput)(result.output, target.statement, _loggerAdapter.appHarnessLogger);
    if (shouldCommit && !(await shouldCommit())) return FAILED;
    const planned = (0, _topicTopup.planTopupTopicRows)(globalTexts, texts, _topicService.normalizeTopicText);
    const res = await (0, _topicService.replaceTopicsForFact)(factId, planned, retireTopicIds);

    // Keep the legacy metadata list in step for unmigrated devices. Append-only
    // (updateFact replaces metadata wholesale, so a naive write would drop it).
    if (res.minted.length > 0) {
      await (0, _factService.appendFactMetadataTopics)(factId, res.minted.map(t => t.text)).catch(err => _logger.default.warn('[topic-replacement] metadata append failed', {
        factId,
        error: String(err)
      }));
    }
    return summarise(res);
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'topic-replacement-service',
        method: 'generateAndReplace'
      }
    });
    return FAILED;
  }
}
const samePlaces = (a, b) => a.length === b.length && a.every(p => b.includes(p));

/**
 * Rebuild a fact's topics for its current places: retire the active non-tracked
 * ones and generate replacements (the existing floor applies). Cloud only;
 * skipped for a fact whose news is stopped. Discarded when the places change
 * while the call runs. Never throws.
 */
async function regenerateTopicsForFact(factId) {
  try {
    // shortcut: on-device regeneration is skipped (no cloud batch call), upgrade with an on-device topic path.
    // Lazy: the store pulls in a wide graph.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      useMeraProtocolStore
    } = require("../../stores/mera-protocol-store");
    if (useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.OnDevice) return FAILED;
    const fact = (await (0, _factService.getFacts)()).find(f => f.id === factId);
    if (!fact || (0, _factService.isNewsStopped)(fact)) return FAILED;
    const snapshot = (0, _factPlaces.factPlaces)(fact);
    const owned = (await (0, _topicService.getByFact)(factId)).filter(t => t.status === 'active');
    const retireIds = owned.filter(t => t.provenance !== 'tracked').map(t => t.id);
    const outcome = await generateAndReplace(factId, Math.max(1, owned.length), retireIds, async () => {
      const now = (await (0, _factService.getFacts)()).find(f => f.id === factId);
      return !!now && !(0, _factService.isNewsStopped)(now) && samePlaces((0, _factPlaces.factPlaces)(now), snapshot);
    });
    if (outcome.ok) await (0, _factService.stampPlacesTopicsFor)(factId, snapshot);
    return outcome;
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'topic-replacement-service',
        method: 'regenerateTopicsForFact'
      }
    });
    return FAILED;
  }
}
function summarise(res) {
  return {
    ok: true,
    minted: res.minted.length,
    retired: res.retired.length,
    floorHeld: res.floorHeld
  };
}