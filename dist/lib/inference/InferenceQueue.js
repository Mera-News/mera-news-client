"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.__setJobHandlerForTests = __setJobHandlerForTests;
exports.inferenceQueue = void 0;
var _reactNative = require("../platform/react-native");
var _inferenceJobService = require("../database/services/inference-job-service");
var _comboPassService = require("../database/services/combo-pass-service");
var _jobDefer = require("./job-defer");
var _factService = require("../database/services/fact-service");
var _topicService = require("../database/services/topic-service");
var _articleSuggestionLifecycle = require("../database/services/article-suggestion-lifecycle");
var _topicGenHandler = require("./handlers/topic-gen-handler");
var _personaSummaryHandler = require("./handlers/persona-summary-handler");
var _storyHeadlineHandler = require("./handlers/story-headline-handler");
var _trackedStoryMigrateHandler = require("./handlers/tracked-story-migrate-handler");
var _topicComboHandler = require("./handlers/topic-combo-handler");
var _onDeviceModel = require("../platform/on-device-model");
var _meraProtocolStore = require("../stores/mera-protocol-store");
var _graphqlTypes = require("../generated/graphql-types");
var _logger = _interopRequireDefault(require("../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// InferenceQueue — Singleton FIFO consumer for on-device LLM jobs.
// Runs queued on-device LLM jobs one at a time. The toolkit's llama lock is the only serialiser of
// llama.rn; pause/resume only gives chat priority over queued jobs.

/** What a handler knows about the row it is running. `jobId` lets a handler
 *  that settles its own job (the combo pass marks it done in the same batch as
 *  its topic writes) name it. */

// Adapt a strongly-typed handler to the generic JobHandler map signature.
// The payload/result shapes are validated by the handler itself; the queue
// only needs the Record<string, unknown> contract for storage/serialization.
function adaptHandler(handler) {
  return (p, ctx) => handler(p, ctx);
}

// EXHAUSTIVE on purpose: a new job type without a handler fails tsc here. A
// row whose type this bundle does not know (an OTA rollback) still reaches the
// `!handler` branch at runtime, which `markUnrunnable` keeps bounded.
const JOB_HANDLERS = {
  topic_gen: adaptHandler(_topicGenHandler.handleTopicGenJob),
  persona_summary: adaptHandler(_personaSummaryHandler.handlePersonaSummaryJob),
  story_headline: adaptHandler(_storyHeadlineHandler.handleStoryHeadlineJob),
  tracked_story_migrate: adaptHandler(_trackedStoryMigrateHandler.handleTrackedStoryMigrateJob),
  topic_combo: adaptHandler(_topicComboHandler.handleTopicComboJob)
};
const REAL_HANDLERS = {
  ...JOB_HANDLERS
};

/** Test seam: override one type's handler; `undefined` restores the real one. */
function __setJobHandlerForTests(type, handler) {
  JOB_HANDLERS[type] = handler ? adaptHandler(handler) : REAL_HANDLERS[type];
}

/**
 * Types whose failures may be a DEFERRAL (lib/inference/job-defer.ts) rather
 * than a spent attempt. The combination pass runs unattended after a chat
 * closes, often exactly when the phone goes offline; a first topic run lost to
 * a brief 503 or a dropped link would leave the reader's Feed without topics.
 */
const DEFERRABLE_TYPES = new Set(['topic_combo', 'topic_gen']);

/** Types `onDrain` does not wait for. A combination pass can sit deferred for
 *  as long as the device is offline, and a fact's "generating more" spinner
 *  must not wait on it. */
const DRAIN_IGNORES = ['topic_combo'];

/**
 * Idle poll cadence, as a BACKOFF rather than a fixed interval.
 *
 * The loop is already event-driven: every enqueue path calls `notify()`
 * (topic-planning-service, tool-handlers,
 * track-actions, PersonaL1MeraProtocol, FactsList), which wakes the sleep
 * immediately. The poll is a safety net for a path that forgets to notify — not
 * the delivery mechanism — so paying two WatermelonDB round-trips every 2s
 * forever buys nothing. In cloud mode the queue is started unconditionally
 * (useModelLifecycle), which made this the only always-running ungated timer in
 * the app.
 *
 * So: start at `POLL_INTERVAL_MIN` and double to `POLL_INTERVAL_MAX` while the
 * queue keeps coming up empty, resetting to MIN the moment anything happens
 * (`wake()` — i.e. notify/resume/stop — or a successful dequeue).
 *
 * `POLL_INTERVAL_MIN` is ALSO the fixed cadence of the `paused` branch, which
 * must NOT back off: paused means chat has priority over queued jobs
 * (useLocalLLM), and a slow re-check there is a slow hand-back to the queue.
 */
const POLL_INTERVAL_MIN = 2000;
const POLL_INTERVAL_MAX = 30000;

/** Prune completed jobs older than this (ms). */
const PRUNE_AGE_MS = 60 * 60 * 1000; // 1 hour

class InferenceQueueImpl {
  constructor() {
    this.state = 'stopped';
    /** Outstanding pause() calls; the queue restarts only when resume() brings it back to 0. */
    this.pauseDepth = 0;
    this.loopPromise = null;
    /** The in-flight stop(): a start() during it must wait, or it re-pends the job the old loop is still running. */
    this.stopping = null;
    /** The in-flight start(): concurrent callers share it so two loops can never be created. */
    this.starting = null;
    /** Only the first start of a process can find a crash leftover in 'running'; later ones find live jobs. */
    this.recoveredThisProcess = false;
    this.wakeResolver = null;
    this.sleepTimer = null;
    this.currentJobPromise = null;
    this.drainCallbacks = [];
    /** Current idle backoff. See POLL_INTERVAL_MIN/MAX. */
    this.idleDelay = POLL_INTERVAL_MIN;
    this.appStateSub = null;
    /**
     * DEFER GATES, per job type: the type is left out of `dequeueJob` until
     * `gateUntil`. In memory on purpose: there is no column for it (a schema bump
     * is not worth it), and losing it on a kill only means an earlier retry,
     * which the pre-check re-gates if the conditions still hold. Gating the TYPE
     * rather than a row is what stops a deferred priority-15 job from sitting at
     * the head of the queue in front of every priority-20 job.
     */
    this.gateUntil = new Map();
    /** Consecutive deferrals per type, for the backoff. Reset on a success. */
    this.deferCount = new Map();
  }
  /**
   * Start the queue consumer loop.
   * Recovers crashed jobs from previous session, then begins processing.
   * Idempotent — safe to call multiple times.
   */
  async start() {
    if (this.stopping) await this.stopping;
    // 'paused' is started: chat holds it, and start() must not hand llama.rn back to the queue.
    if (this.state !== 'stopped') return;
    this.starting ??= this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  async doStart() {
    // Recover any jobs that were 'running' when the app crashed
    if (!this.recoveredThisProcess) {
      await (0, _inferenceJobService.recoverCrashedJobs)();
      this.recoveredThisProcess = true;
    }
    // Prune old completed jobs
    const pruneDate = new Date(Date.now() - PRUNE_AGE_MS);
    await (0, _inferenceJobService.pruneCompletedJobs)(pruneDate).catch(() => {});

    // Rescue facts whose topic_gen job died without setting topicGenError
    // (e.g. max retries exhausted → job destroyed, crash before markFailed).
    // Without this the UI spins on "Generating topics..." forever and the
    // fact becomes effectively undeletable from the user's perspective.
    try {
      const activeFactIds = await (0, _inferenceJobService.getActiveTopicGenFactIds)();
      const orphaned = await (0, _factService.markOrphanedFactsAsFailed)(activeFactIds, 'Topic generation failed — please delete and retry.');
      if (orphaned > 0) {
        _logger.default.warn('[InferenceQueue] Marked orphaned facts as failed', {
          count: orphaned
        });
      }
    } catch (err) {
      _logger.default.error('[InferenceQueue] Orphan-fact sweep failed', err);
    }

    // Repair sweep: destroy topics whose owning fact is gone. Facts deleted
    // before destroyCascade actually cascaded (2026-08-03) left their topics
    // active — still fetching content for the deleted interest and emptying
    // the Dashboard (see topic-service.destroyOrphanedTopics).
    try {
      const factIds = new Set((await (0, _factService.getFacts)()).map(f => f.id));
      const destroyed = await (0, _topicService.destroyOrphanedTopics)(factIds);
      if (destroyed > 0) {
        _logger.default.warn('[InferenceQueue] Destroyed orphaned topics', {
          count: destroyed
        });
      }
      // Same repair on the other side of the join: suggestions retrieved by
      // topics that no longer exist can never render a Dashboard section, so
      // they are dead weight on devices that deleted facts. Runs every start
      // (cheap when there is nothing to purge), not just when topics were
      // destroyed above — a device may already have swept its topics.
      const purged = await (0, _articleSuggestionLifecycle.purgeSuggestionsForDeadTopics)(await (0, _topicService.getAllTopicIds)());
      if (purged > 0) {
        _logger.default.warn('[InferenceQueue] Purged suggestions for dead topics', {
          count: purged
        });
      }
    } catch (err) {
      _logger.default.error('[InferenceQueue] Orphan-topic sweep failed', err);
    }
    const stats = await (0, _inferenceJobService.getQueueStats)();
    this.state = 'running';
    this.idleDelay = POLL_INTERVAL_MIN;
    this.armAppStateGate();
    this.loopPromise = this.consumeLoop();

    // Log details of any failed jobs for debugging
    if (stats.failed > 0) {
      const failedJobs = await (0, _inferenceJobService.getFailedJobs)();
      for (const job of failedJobs) {
        _logger.default.warn('[InferenceQueue] Failed job', {
          jobId: job.id,
          jobType: job.jobType,
          error: job.errorMessage,
          attempts: job.attempts,
          payload: JSON.stringify(job.payload).slice(0, 300)
        });
      }
    }
  }

  /**
   * Stop the queue consumer loop.
   * Waits for the current job to finish, then stops.
   */
  async stop() {
    // A stop during start's setup must stop what that start began, not be lost to the 'stopped' check.
    if (this.starting) await this.starting;
    if (this.state === 'stopped') return this.stopping ?? undefined;
    this.state = 'stopped';
    this.pauseDepth = 0;
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.wake(); // unblock any sleep
    const loop = this.loopPromise;
    this.loopPromise = null;
    if (!loop) return;
    this.stopping = loop.finally(() => {
      this.stopping = null;
    });
    await this.stopping;
  }

  /**
   * Pause processing and wait for the current job to finish.
   * Gives chat priority over queued jobs; it is NOT exclusive llama.rn access.
   * The toolkit lock is the only serialiser (scoring calls completeLocal outside this queue).
   */
  async pause() {
    if (this.state === 'stopped') return;
    // Ref-counted: a chat turn mid scoring pass must not un-pause the pass's hold.
    this.pauseDepth += 1;
    this.state = 'paused';
    if (this.currentJobPromise) {
      await this.currentJobPromise;
    }
  }

  /**
   * Resume processing after a pause.
   */
  resume() {
    if (this.pauseDepth > 0) this.pauseDepth -= 1;
    if (this.pauseDepth === 0 && this.state === 'paused') {
      this.state = 'running';
      this.wake(); // unblock the sleep so it picks up jobs immediately
    }
  }

  /**
   * Notify the queue that a new job was enqueued.
   * Wakes the loop from its poll sleep so it picks up the job faster.
   */
  notify() {
    this.wake();
  }

  /** Current queue state. */
  getState() {
    return this.state;
  }

  /**
   * Synchronous "is on-device inference busy right now?" signal for low-priority
   * background schedulers to yield to. True when a job is actively executing OR
   * the queue is paused so chat has priority. Deliberately does
   * NOT count merely-pending jobs (the loop is idle between polls, and those
   * polls now back off to 30s) — this is a best-effort "something important is
   * running" check, not a backlog gauge.
   */
  isBusy() {
    return this.currentJobPromise !== null || this.state === 'paused';
  }

  /**
   * Register a callback to be invoked once when the queue has no more pending jobs.
   * Callbacks are one-shot — they fire once and are removed.
   */
  onDrain(callback) {
    this.drainCallbacks.push(callback);
  }

  /** Test seam: clear every defer gate and backoff, and forget that this process already recovered. */
  __resetTypeGatesForTests() {
    this.recoveredThisProcess = false;
    this.gateUntil.clear();
    this.deferCount.clear();
  }

  // ── Internal ────────────────────────────────────────────────

  /** Types still inside their defer window; expired gates are dropped. */
  gatedTypes() {
    const now = Date.now();
    const out = [];
    for (const [type, until] of this.gateUntil) {
      if (until > now) out.push(type);else this.gateUntil.delete(type);
    }
    return out;
  }
  deferType(type, reason) {
    const count = this.deferCount.get(type) ?? 0;
    const delay = (0, _jobDefer.deferDelayMs)(count);
    this.deferCount.set(type, count + 1);
    this.gateUntil.set(type, Date.now() + delay);
    _logger.default.debug('[InferenceQueue] Deferred job type', {
      type,
      reason,
      delayMs: delay
    });
  }
  async fireDrainIfIdle() {
    if (this.drainCallbacks.length === 0) return;
    const remaining = await (0, _inferenceJobService.countActiveJobsExcluding)(DRAIN_IGNORES).catch(() => 1);
    if (remaining > 0) return;
    const callbacks = this.drainCallbacks.splice(0);
    for (const cb of callbacks) {
      try {
        cb();
      } catch (err) {
        _logger.default.error('[InferenceQueue] Drain callback failed', err);
      }
    }
  }
  async afterComboSettled() {
    await (0, _comboPassService.finishComboPassIfDrained)().catch(err => _logger.default.error('[InferenceQueue] End-of-pass check failed', err));
  }
  async consumeLoop() {
    while (this.state !== 'stopped') {
      // If paused, sleep until resumed or stopped. Deliberately the FIXED
      // minimum, never the backoff — see POLL_INTERVAL_MIN.
      if (this.state === 'paused') {
        await this.sleep(POLL_INTERVAL_MIN);
        continue;
      }

      // The built-in model works only in the foreground (Gemini Nano refuses
      // background work, Apple throttles it), so on it nothing starts until the
      // app is active again. Checked before the dequeue: waiting spends no
      // attempt. The AppState gate wakes this sleep on return.
      if (await this.waitsForForeground()) {
        this.idleDelay = POLL_INTERVAL_MAX;
        await this.sleep(POLL_INTERVAL_MAX);
        continue;
      }
      const stats = await (0, _inferenceJobService.getQueueStats)();
      if (stats.pending > 0 || stats.running > 0 || stats.failed > 0) {
        _logger.default.debug('[InferenceQueue] Queue stats', stats);
      }

      // Auto-delete any lingering failed jobs
      if (stats.failed > 0) {
        await (0, _inferenceJobService.purgeFailedJobs)().catch(e => _logger.default.warn('[InferenceQueue] Failed to purge failed jobs', {
          error: String(e)
        }));
      }

      // Drain = no NON-combo work left (see DRAIN_IGNORES). Checked before the
      // dequeue so a combo job at the head does not hold it back.
      await this.fireDrainIfIdle();
      const job = await (0, _inferenceJobService.dequeueJob)({
        excludeTypes: this.gatedTypes()
      });
      if (!job) {
        // Nothing to do — back off before polling again, so an idle app is not
        // running two DB round-trips every 2s forever. Any enqueue calls
        // notify() -> wake(), which resets this to the minimum immediately.
        //
        // The backoff MUST advance before the await, not after it. `wake()` and
        // the AppState gate both write `idleDelay` while this sleep is pending;
        // advancing afterwards would overwrite what they wrote and the next
        // sleep would use a stale value (a notify() landed on 4000 instead of
        // 2000, and a background landed on 4000 instead of the 30s cap).
        const delay = this.idleDelay;
        this.idleDelay = Math.min(delay * 2, POLL_INTERVAL_MAX);
        await this.sleep(delay);
        continue;
      }

      // Real work found: the app is active again, so drop straight back to the
      // fast cadence rather than crawling out of the backoff one job at a time.
      this.idleDelay = POLL_INTERVAL_MIN;

      // Check state again after dequeue (might have been paused/stopped while querying)
      if (this.state !== 'running') continue;
      const isCombo = job.jobType === 'topic_combo';

      // Combo pre-check, BEFORE markRunning so a "not now" spends no attempt.
      if (isCombo) {
        const verdict = await (0, _comboPassService.precheckComboJob)().catch(() => 'defer');
        if (verdict === 'defer') {
          this.deferType(job.jobType, 'precheck');
          continue;
        }
        if (verdict === 'drop') {
          // Switched to on-device mid-pass: the pass does not apply there.
          await (0, _comboPassService.dropPendingComboJobs)().catch(err => _logger.default.error('[InferenceQueue] Dropping combo jobs failed', err));
          await this.afterComboSettled();
          continue;
        }
      }
      const handler = JOB_HANDLERS[job.jobType];
      if (!handler) {
        // markUnrunnable COUNTS an attempt. Plain markFailed did not (the job
        // never reached markRunning), so an OTA rollback that left a job type
        // this bundle cannot run re-pended it on every loop, forever.
        _logger.default.error('[InferenceQueue] Unknown job type', {
          jobType: job.jobType,
          jobId: job.id
        });
        await job.markUnrunnable(`Unknown job type: ${job.jobType}`);
        if (isCombo) await this.afterComboSettled();
        continue;
      }
      const jobExec = (async () => {
        let deferred = false;
        try {
          await job.markRunning();
          const result = await handler(job.payload, {
            jobId: job.id
          });
          await job.markDone(result);
          this.deferCount.delete(job.jobType);
        } catch (err) {
          const errorMsg = err?.message || (err ? String(err) : 'Native crash (no error message)');
          if (DEFERRABLE_TYPES.has(job.jobType) && (0, _jobDefer.isDeferrableError)(err) || (0, _jobDefer.isOnDeviceDeferrable)(err)) {
            deferred = true;
            _logger.default.warn('[InferenceQueue] Job deferred', {
              jobId: job.id,
              jobType: job.jobType,
              error: errorMsg
            });
            await job.markDeferred(errorMsg);
            this.deferType(job.jobType, errorMsg);
            return;
          }
          _logger.default.error('[InferenceQueue] Job failed', err, {
            jobId: job.id,
            jobType: job.jobType,
            attempt: job.attempts,
            error: errorMsg
          });
          await job.markFailed(errorMsg);

          // Native crash (no error message) likely corrupts the llama context.
          // Reset it so the next job gets a fresh context.
          if (!err?.message) {
            _logger.default.warn('[InferenceQueue] Native crash detected, resetting llama context');
            await (0, _onDeviceModel.resetContext)().catch(e => _logger.default.error('[InferenceQueue] Context reset failed', e));
          }
        } finally {
          if (isCombo && !deferred) await this.afterComboSettled();
        }
      })();
      this.currentJobPromise = jobExec;
      await jobExec;
      this.currentJobPromise = null;
    }
  }

  /** On this phone (the built-in text model), while the app is not active. */
  async waitsForForeground() {
    if (_reactNative.AppState.currentState === 'active') return false;
    return _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.OnDevice;
  }
  sleep(ms) {
    return new Promise(resolve => {
      this.wakeResolver = resolve;
      // Only clear the resolver if it is still ours: an earlier sleep's timer must never
      // null the NEXT sleep's resolver (wake() clears the timer, so it cannot fire late).
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        if (this.wakeResolver === resolve) this.wakeResolver = null;
        resolve();
      }, ms);
    });
  }
  wake() {
    // Any wake is evidence something happened (notify / resume / stop), so the
    // backoff has served its purpose and resets.
    this.idleDelay = POLL_INTERVAL_MIN;
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    if (this.wakeResolver) {
      this.wakeResolver();
      this.wakeResolver = null;
    }
  }

  /**
   * Foreground gate. Backgrounding pins the idle poll to its slowest cadence;
   * returning to the foreground resets it and wakes the loop at once.
   *
   * Deliberately NOT `stop()` on background: stop() makes the next start() redo
   * recoverCrashedJobs + the orphan-fact/topic sweeps + a stats read, so gating
   * that way would pay a full repair pass on every single foreground.
   *
   * In-flight work is untouched — only the empty-queue sleep changes — so
   * `isBusy()` keeps reporting truthfully for background-idle.ts, and a job
   * enqueued while backgrounded still calls notify() -> wake() and runs at once,
   * except on the built-in model, where it waits for the foreground
   * (`waitsForForeground`).
   */
  armAppStateGate() {
    if (this.appStateSub) return;
    this.appStateSub = _reactNative.AppState.addEventListener('change', next => {
      if (next === 'active') {
        // A return is the natural moment to retry a deferral (the network is
        // often back); the pre-check re-gates at once if it is not.
        this.gateUntil.clear();
        this.wake(); // resets idleDelay to the minimum and unblocks the sleep
      } else {
        this.idleDelay = POLL_INTERVAL_MAX;
      }
    });
  }
}

/** Singleton instance. Import this everywhere. */
const inferenceQueue = exports.inferenceQueue = new InferenceQueueImpl();