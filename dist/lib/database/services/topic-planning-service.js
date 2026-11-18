"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.generateMoreAndWait = generateMoreAndWait;
exports.generateMoreTopicsForFact = generateMoreTopicsForFact;
exports.holdFactOnScreen = holdFactOnScreen;
exports.promisesRemoval = promisesRemoval;
exports.sweepTopicLifecycle = sweepTopicLifecycle;
var _inferenceJobService = require("./inference-job-service");
var _topicService = require("./topic-service");
var _factService = require("./fact-service");
var _personaChangeLogService = require("./persona-change-log-service");
var _topicGenerationStatusService = require("./topic-generation-status-service");
var _networkStore = require("../../stores/network-store");
var _schedulerStore = require("../../scheduler/scheduler-store");
var _topicGenHandler = require("../../inference/handlers/topic-gen-handler");
var _InferenceQueue = require("../../inference/InferenceQueue");
var _meraProtocolStore = require("../../stores/mera-protocol-store");
var _graphqlTypes = require("../../generated/graphql-types");
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Topic-Planning Service — the "generate more topics" action for
// the in-chat cards and the Profile. Mints ADDITIONAL topics for one fact; the
// job itself excludes the texts the fact already owns and every declined one. Respects the
// user's processing-mode privacy choice: cloud mode runs the one-shot cloud
// generation inline; on-device mode enqueues an append job on the inference
// queue (so it never contends with chat for llama.rn on the main thread).
//
// Both paths reuse handleTopicGenJob, which does the legacy metadata dual-write
// AND the `topics`-row minting (via topic-service.syncLlmTopicsForFact),
// so the new rows reach the feed and the widget's observeByFact query updates
// reactively.

/**
 * Generate additional topics for ONE fact, isolated: the job reads
 * this fact's own topics and every declined topic itself, at run time, so no
 * exclusion snapshot is passed. `skillId` is optional; the handler derives one
 * from the fact's attribute. Never throws: a failure is `skipped`.
 */
async function generateMoreTopicsForFact(factId, factStatement, opts = {}) {
  const extra = {
    ...(opts.skillId ? {
      skillId: opts.skillId
    } : {}),
    ...(opts.count ? {
      totalCount: opts.count
    } : {})
  };
  const useCloud = _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.Cloud;
  if (useCloud) {
    try {
      const out = await (0, _topicGenHandler.handleTopicGenJob)({
        factId,
        factStatement,
        useCloud: true,
        mode: 'append',
        ...extra
      });
      if (out.outcome === 'error') return {
        mode: 'skipped',
        added: 0
      };
      return {
        mode: 'inline',
        added: out.topics.length
      };
    } catch (err) {
      _logger.default.warn('[topic-planning] cloud generate-more failed', {
        factId,
        error: String(err)
      });
      return {
        mode: 'skipped',
        added: 0
      };
    }
  }

  // On-device: enqueue an append job (deduped against an in-flight one).
  if (await (0, _inferenceJobService.hasPendingJob)('topic_gen', 'factId', factId)) {
    return {
      mode: 'skipped',
      added: 0
    };
  }
  await (0, _inferenceJobService.enqueueJob)('topic_gen', {
    factId,
    factStatement,
    useCloud: false,
    mode: 'append',
    ...extra
  });
  _InferenceQueue.inferenceQueue.notify();
  return {
    mode: 'queued',
    added: 0
  };
}

/** shortcut: a queue that never drains (a type deferred for long) ends the wait
 *  here and reads as what has landed so far; a real error on device reads as
 *  nothing new. Upgrade by reading the job row's outcome. */
const QUEUED_RUN_WAIT_MS = 90_000;

/**
 * Generate more as both surfaces need it: resolves when the run is over, with
 * the rows it added, on either engine. An on-device run is a queued job, so its
 * count is the difference in rows once the queue drains.
 */
async function generateMoreAndWait(factId, factStatement, opts = {}) {
  const before = (await (0, _topicService.getByFact)(factId)).length;
  const out = await generateMoreTopicsForFact(factId, factStatement, opts);
  if (out.mode !== 'queued') return out;
  await new Promise(resolve => {
    _InferenceQueue.inferenceQueue.onDrain(resolve);
    setTimeout(resolve, QUEUED_RUN_WAIT_MS);
  });
  return {
    mode: 'queued',
    added: Math.max(0, (await (0, _topicService.getByFact)(factId)).length - before)
  };
}

/** Stays off until proven on staging. Off, the sweep still retries and settles; it removes nothing. */
const AUTO_DELETE_ENABLED = false;
/** Whether the empty line may tell the reader Mera will remove this fact. While
 *  removal is off nothing says it will happen. */
function promisesRemoval(fact) {
  return AUTO_DELETE_ENABLED && (0, _factService.isRemovableEmptyFact)(fact);
}
const MAX_LADDERS_PER_SWEEP = 3;
const MAX_REMOVALS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A device clock set back and forward again can leave a stamp in the future. */
const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const onScreen = new Map();

/** A fact on screen is never removed under the reader. Returns the release. */
function holdFactOnScreen(factId) {
  onScreen.set(factId, (onScreen.get(factId) ?? 0) + 1);
  return () => {
    const left = (onScreen.get(factId) ?? 1) - 1;
    if (left > 0) onScreen.set(factId, left);else onScreen.delete(factId);
  };
}
let sweeping = false;

/**
 * The empty-fact lifecycle, one pass per foreground. Stuck facts move onto it,
 * due facts get a background ladder, and only a sweep that ran no ladder may
 * remove a fact, so nothing goes in the session that last asked about it.
 */
async function sweepTopicLifecycle({
  now = Date.now(),
  autoDelete = AUTO_DELETE_ENABLED
} = {}) {
  if (sweeping || _schedulerStore.useSchedulerStore.getState().isRunning('feed-sync')) return {
    ladders: 0,
    removed: 0
  };
  sweeping = true;
  try {
    const facts = await (0, _factService.getFacts)();
    const live = await (0, _inferenceJobService.getActiveTopicGenFactIds)();
    for (const fact of facts) {
      if (fact.topicsStatus !== 'error' || fact.metadata?.topicGenError?.[0] !== _topicGenerationStatusService.LEGACY_EMPTY_ERROR) continue;
      if (live.has(fact.id)) continue;
      if ((await (0, _topicService.getByFact)(fact.id)).length > 0) await (0, _topicGenerationStatusService.markTopicGenerationSettled)([fact.id]);else await (0, _topicGenerationStatusService.settleEmptyTopicGeneration)(fact.id, fact.statement);
    }
    const useCloud = _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.Cloud;
    const online = _networkStore.useNetworkStore.getState().isConnected;
    const clocked = (await (0, _factService.getFacts)()).filter(f => f.topicsStatus === 'done' && f.metadata?.[_topicGenerationStatusService.TOPICS_EMPTY_SINCE] != null && !live.has(f.id));
    let ladders = 0;
    for (const fact of clocked) {
      const meta = fact.metadata;
      if (meta.news_stopped === true || Number(meta[_topicGenerationStatusService.TOPICS_UNREADABLE_RUNS] ?? 0) >= _topicGenerationStatusService.MAX_UNREADABLE_RUNS) continue;
      // Waiting on the reader's tap: a ladder is a model call.
      if (meta[_topicGenerationStatusService.TOPICS_ASK_REMOVAL] === true) continue;
      const since = Number(meta[_topicGenerationStatusService.TOPICS_EMPTY_SINCE]);
      const retryAt = Number(meta[_topicGenerationStatusService.TOPICS_RETRY_AT] ?? 0);
      const runs = Number(meta[_topicGenerationStatusService.TOPICS_EMPTY_RUNS] ?? 0);
      if (since > now + CLOCK_TOLERANCE_MS || retryAt > now + _topicGenerationStatusService.SECOND_RETRY_GAP_MS + CLOCK_TOLERANCE_MS) {
        await (0, _factService.patchMetadata)(fact.id, {
          ...(since > now + CLOCK_TOLERANCE_MS ? {
            [_topicGenerationStatusService.TOPICS_EMPTY_SINCE]: now
          } : {}),
          [_topicGenerationStatusService.TOPICS_RETRY_AT]: now
        });
        continue;
      }
      if (runs >= _factService.EMPTY_FACT_REQUIRED_RUNS || now < retryAt || ladders >= MAX_LADDERS_PER_SWEEP) continue;
      if (useCloud && !online) continue;
      await (0, _inferenceJobService.enqueueJob)('topic_gen', {
        factId: fact.id,
        factStatement: fact.statement,
        useCloud,
        background: true
      });
      ladders++;
    }
    if (ladders > 0) _InferenceQueue.inferenceQueue.notify();
    if (!autoDelete || ladders > 0) return {
      ladders,
      removed: 0
    };
    if ((await (0, _personaChangeLogService.countEmptyFactRemovals)(now - DAY_MS)) >= MAX_REMOVALS_PER_DAY) return {
      ladders,
      removed: 0
    };
    for (const fact of clocked) {
      if (!(0, _factService.isRemovableEmptyFact)(fact) || onScreen.has(fact.id)) continue;
      if (Number(fact.metadata?.[_topicGenerationStatusService.TOPICS_EMPTY_RUNS] ?? 0) < _factService.EMPTY_FACT_REQUIRED_RUNS) continue;
      if (now - Number(fact.metadata?.[_topicGenerationStatusService.TOPICS_EMPTY_SINCE]) < _factService.EMPTY_FACT_MIN_AGE_MS) continue;
      // One per sweep: the inbox row names one fact and its Add it back one draft.
      if (await (0, _factService.removeEmptyFact)(fact.id, fact.statement, now)) return {
        ladders,
        removed: 1
      };
    }
    return {
      ladders,
      removed: 0
    };
  } finally {
    sweeping = false;
  }
}