"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.COMBO_MAX_SUPPORTING_FACTS = void 0;
exports.handleTopicComboJob = handleTopicComboJob;
var _comboPassService = require("../../database/services/combo-pass-service");
var _factService = require("../../database/services/fact-service");
var _topicService = require("../../database/services/topic-service");
var _topicDeclineService = require("../../database/services/topic-decline-service");
var _cloudComplete = require("../../llm/cloudComplete");
var _graphqlTypes = require("../../generated/graphql-types");
var _personaPrompts = require("../../news-harness/prompts/persona-prompts");
var _topicGeneration = require("../../news-harness/persona-management/topic-generation");
var _topicTopup = require("../../news-harness/persona-management/topic-topup");
var _jobDefer = require("../job-defer");
var _factPlaces = require("../../news-harness/persona-management/fact-places");
var _meraHarness = require("../../mera-harness");
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Handler for topic_combo jobs: the DEFERRED COMBINATION PASS.
//
// Topic generation per fact is isolated (topic-gen-handler.ts). The topics
// that exist only because two facts sit side by side ("Portugal nurse pay
// dispute" from a nurse living in Porto) come from here, once per fact, after
// a Profile chat that changed facts closes. Cloud only: on-device mode gets
// isolated topics and nothing else (owner decision).
//
// ONE batched cloud call per run: this job's fact plus up to seven pending
// siblings of the same pass (the gateway's batch concurrency). Each fact gets
// its own call over itself plus up to 25 supporting facts, newest first, with
// no location line. Results are deduped against every topic on the device, the
// full declined list and each other, then written per fact as a diff by
// `applyComboTopicsForFact`, which also marks that fact's job done.
//
// THE QUEUE OWNS THE HEAD JOB: it marked it running and settles it from this
// handler's return or throw (a deferrable throw re-pends it with no attempt
// spent). The SIBLINGS are this handler's: claimed here, so every one not
// applied must be given back with `releaseComboJobs`, or it sits 'running'
// until the next launch and holds the pass open.

/** Supporting facts per call, newest first. */
const COMBO_MAX_SUPPORTING_FACTS = exports.COMBO_MAX_SUPPORTING_FACTS = 25;
const COMBO_TEMPERATURE = 0.3;
/** Four topics plus JSON is well under this; thinking is off. */
const COMBO_MAX_TOKENS = 400;
async function handleTopicComboJob(payload, ctx) {
  // The setting row, NOT the store: the queue can run before hydration, when
  // the store still holds its cloud default.
  if ((await (0, _comboPassService.readProcessingModeSetting)()) !== _graphqlTypes.ProcessingMode.Cloud) {
    await (0, _comboPassService.dropPendingComboJobs)();
    return {
      applied: 0
    };
  }
  const siblings = (await (0, _comboPassService.claimSiblings)(payload.passId, _comboPassService.COMBO_SIBLING_LIMIT - 1)).filter(s => s.jobId !== ctx.jobId);
  /** Siblings not yet applied or given back. Emptied as each settles. */
  const outstanding = new Set(siblings.map(s => s.jobId));
  const work = [{
    jobId: ctx.jobId,
    factId: payload.factId
  }, ...siblings];
  try {
    const facts = await (0, _factService.getFacts)();
    const byId = new Map(facts.map(f => [f.id, f]));
    const calls = [];
    let applied = 0;
    for (const w of work) {
      const fact = byId.get(w.factId);
      const supporting = fact ? facts.filter(f => f.id !== fact.id).slice(0, COMBO_MAX_SUPPORTING_FACTS).map(f => f.statement) : [];
      if (!fact || supporting.length === 0) {
        // Deleted since the pass was queued, or nothing to combine with: an
        // empty apply clears any stale combo rows and settles the job.
        await (0, _comboPassService.applyComboTopicsForFact)(w.factId, [], w.jobId);
        outstanding.delete(w.jobId);
        continue;
      }
      calls.push({
        id: w.jobId,
        system: _personaPrompts.COMBO_PASS_TOPIC_SYSTEM_PROMPT,
        prompt: (0, _personaPrompts.buildComboPassUserMessage)(fact.statement, supporting, _personaPrompts.COMBO_PASS_MAX_TOPICS, (0, _factPlaces.describeFactPlaces)(fact)),
        temperature: COMBO_TEMPERATURE,
        maxTokens: COMBO_MAX_TOKENS,
        enableThinking: false
      });
    }
    if (calls.length === 0) return {
      applied
    };
    const results = await (0, _cloudComplete.cloudBatchComplete)(calls, 'topics', {
      lane: 'background'
    });
    const byCall = new Map(results.map(r => [r.id, r]));

    // Every topic on the device and every declined text, then each accepted
    // text as it lands, so two facts in one batch cannot mint near twins.
    const seen = new Set([...(await (0, _topicService.getAllNormalizedTexts)()), ...(await (0, _topicDeclineService.getAllDeclinedNormalizedTexts)())]);
    let headError = null;
    for (const w of work) {
      const call = calls.find(c => c.id === w.jobId);
      if (!call) continue;
      const result = byCall.get(w.jobId);
      const error = !result ? 'no result for this fact' : result.error ?? null;
      if (error) {
        if (w.jobId === ctx.jobId) headError = error;else {
          await (0, _comboPassService.releaseComboJobs)([w.jobId], {
            error
          });
          outstanding.delete(w.jobId);
        }
        continue;
      }
      const statement = byId.get(w.factId)?.statement ?? '';
      // Every combination topic names its own fact: the prompt says
      // so, and this drops the ones that still do not.
      const aboutFact = (0, _topicGeneration.parseTopicsFromOutput)(result.output, statement).filter(t => (0, _meraHarness.namesFact)(t, statement));
      const texts = (0, _topicTopup.planTopupTopicRows)(seen, (0, _meraHarness.capitalizePlaceNames)(aboutFact, (0, _factPlaces.describeFactPlaces)(byId.get(w.factId))), _topicService.normalizeTopicText).map(row => row.text).slice(0, _personaPrompts.COMBO_PASS_MAX_TOPICS);
      for (const t of texts) seen.add((0, _topicService.normalizeTopicText)(t));
      await (0, _comboPassService.applyComboTopicsForFact)(w.factId, texts, w.jobId);
      outstanding.delete(w.jobId);
      applied++;
    }
    if (headError !== null) throw new Error(headError);
    return {
      applied
    };
  } catch (err) {
    if (outstanding.size > 0) {
      const outcome = (0, _jobDefer.isDeferrableError)(err) ? 'defer' : {
        error: err instanceof Error ? err.message : String(err)
      };
      await (0, _comboPassService.releaseComboJobs)([...outstanding], outcome).catch(releaseErr => _logger.default.error('[topic-combo] releasing siblings failed', releaseErr, {
        passId: payload.passId
      }));
    }
    throw err;
  }
}