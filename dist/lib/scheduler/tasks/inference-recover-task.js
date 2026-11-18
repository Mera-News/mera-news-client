"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BACKGROUND_COLLECT_WAIT_MS = void 0;
exports.__resetColdStartLatchForTests = __resetColdStartLatchForTests;
var _cycleStateMachine = require("../../services/cycle-state-machine");
var _factService = require("../../database/services/fact-service");
var _topicDeclineService = require("../../database/services/topic-decline-service");
var _topicService = require("../../database/services/topic-service");
var _comboPassService = require("../../database/services/combo-pass-service");
var _topicPlanningService = require("../../database/services/topic-planning-service");
var _factsDraftService = require("../../services/facts-draft-service");
var _turnInflight = require("../../chat-session/turn-inflight");
var _logger = _interopRequireDefault(require("../../logger"));
var _collectGate = require("../../background/collect-gate");
var _AppScheduler = require("../AppScheduler");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * How long recovery waits for a background collect (the `mera-background` OS
 * task's step (a)) that is still running when the reader opens the app. The
 * pipeline's per-batch claim already stops both from applying one batch twice;
 * waiting lets recovery start from what the collect wrote instead of racing it.
 */
const BACKGROUND_COLLECT_WAIT_MS = exports.BACKGROUND_COLLECT_WAIT_MS = 20_000;

/**
 * First run in THIS JS context. A kill, a crash and a JS reload all start a new
 * context, and in every one of them the Profile chat is certainly closed, so
 * that first run may treat a still-open facts draft as abandoned. On a plain
 * foreground the chat may legitimately be open, so the draft is not touched.
 * Deliberately not `coldStart` from the scheduler: that is false on a JS reload,
 * which closes the chat just the same.
 */
let firstRunDone = false;

/** Test seam. */
function __resetColdStartLatchForTests() {
  firstRunDone = false;
}

/**
 * Resume the combination pass. On the first run, a draft the Profile chat left
 * open with different facts becomes a pending pass first. Then a pending flag
 * becomes jobs (cloud) or a refresh (on-device); a pass already queued resumes
 * on its own once the queue runs.
 */
async function resumeComboPass(ctx) {
  try {
    if (!firstRunDone) {
      firstRunDone = true;
      if (await (0, _factsDraftService.recoverOpenFactsDraft)()) ctx.log('facts draft left open with changes');
    }
    const outcome = await (0, _comboPassService.runPendingComboPass)();
    if (outcome !== 'none') ctx.log(`combination pass: ${outcome}`);
  } catch (err) {
    // Never fail recovery over it: the flag stays set and the next foreground
    // tries again.
    _logger.default.captureException(err, {
      tags: {
        task: 'inference-recover',
        step: 'combo-pass'
      }
    });
  }
}
_AppScheduler.AppScheduler.register({
  name: 'inference-recover',
  displayName: 'Inference Recovery',
  frequency: 0,
  triggers: ['app-foreground'],
  // db-ready ONLY — deliberately NOT network/authenticated. Recovery re-arms the
  // scoring poller and aborts/finalizes a wedged LOCAL run; neither needs a live
  // session or network (the poller handles auth/network per-tick). A persisted
  // `needsReauth` window (r7 A) used to fail the `authenticated` gate and the
  // offline app failed the `network` gate — either one starved this task, so a
  // run left stuck 'running' had nothing to reset it and feed-sync (which skips
  // while scoring is in flight) never fetched again. Un-gating restores the
  // self-heal.
  conditions: [{
    type: 'db-ready'
  }],
  timeout: 120_000,
  maxAttempts: 1,
  exclusive: true,
  handler: async (_input, ctx) => {
    await (0, _collectGate.waitForBackgroundCollect)(BACKGROUND_COLLECT_WAIT_MS);
    ctx.log('recovering cycle');
    await (0, _cycleStateMachine.recoverCycle)();

    // Facts left 'pending' by a generation job that died. Deliberately here
    // and not only on InferenceQueue.start(): that path is reached from
    // useModelLifecycle and, in on-device mode, waits for the model to load,
    // so a device whose model never loads would never sweep.
    const rescued = await (0, _factService.rescueStalePendingTopicFacts)();
    if (rescued > 0) ctx.log(`rescued ${rescued} stale pending facts`);

    // Topics minted before `weight` was required on CreateTopicInput. A
    // weight of 0 is dropped by buildRetrievalProfile before the feed request
    // is built, so these render on the Profile and are never queried. Here
    // rather than in a migration: the repair needs no schema change, and a
    // version bump carrying a data-only fix cannot be walked back by an OTA
    // rollback without the adapter reaching for "resetting database instead".
    const reweighted = await (0, _topicService.repairUnweightedTopics)();
    if (reweighted > 0) ctx.log(`re-weighted ${reweighted} unqueryable topics`);

    // Commit any topic delete staged before the app was killed or
    // backgrounded. This is the "app start and every foreground" half of the
    // flush contract — the service's 5s timer is only the fast path, and a
    // component must never own it.
    const committed = await (0, _topicDeclineService.flushPendingDeletes)();
    if (committed > 0) ctx.log(`committed ${committed} staged topic deletes`);

    // After the flush, so the pass reads the persona the user actually sees.
    await resumeComboPass(ctx);
    try {
      const swept = await (0, _topicPlanningService.sweepTopicLifecycle)();
      if (swept.ladders + swept.removed > 0) ctx.log(`topic lifecycle: ${swept.ladders} retries, ${swept.removed} removed`);
    } catch (err) {
      // Never fail recovery over it: the next foreground sweeps again.
      _logger.default.captureException(err, {
        tags: {
          task: 'inference-recover',
          step: 'topic-lifecycle'
        }
      });
    }
    if (await (0, _turnInflight.recoverInterruptedTurn)()) ctx.log('a chat turn ended with the app');

    // No ctx.markNoOp(): "nothing to rescue, nothing staged" is the NORMAL
    // state, and suppressing the lastRun stamp on a routine skip turns this
    // into a silent 5s infinite loop.
  }
});