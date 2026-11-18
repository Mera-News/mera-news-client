"use strict";

var _optimisationPlanService = require("../../database/services/optimisation-plan-service");
var _AppScheduler = require("../AppScheduler");
var _backgroundIdle = require("../background-idle");
// Feedback-optimisation cycle. Comes due every 3h but is a LOW-
// PRIORITY, idle-gated task: it only runs when the app isn't syncing the feed or
// running on-device inference (backgroundWorkIsIdle), and otherwise re-checks on
// the next tick — so it fires at the first quiet moment after coming due. The
// service-level guards inside runOptimisationCycle (cooldown + a minimum number
// of unprocessed verdicts) still bound how often it actually produces a plan, so
// most due ticks are a couple of cheap reads. When the digest finds actionable
// changes it stores ONE optimisation plan and fires an `optimisation_plan`
// notification whose `review-plan` chip opens Mera chat.

const EVERY_3H_MS = 3 * 60 * 60 * 1000;
_AppScheduler.AppScheduler.register({
  name: 'feedback-cycle',
  displayName: 'Feedback Optimisation',
  frequency: EVERY_3H_MS,
  triggers: [],
  // db-ready + idle: defer to the feed sync / inference queue (lower priority).
  conditions: [{
    type: 'db-ready'
  }, {
    type: 'custom',
    check: _backgroundIdle.backgroundWorkIsIdle
  }],
  timeout: 30_000,
  maxAttempts: 2,
  exclusive: true,
  handler: async (_input, ctx) => {
    const result = await (0, _optimisationPlanService.runOptimisationCycle)();
    if (!result.ran) {
      ctx.log(`optimisation cycle skipped — ${result.reason ?? 'not-eligible'}`);
      return;
    }
    ctx.log(`optimisation cycle complete — ${result.autoCount} auto + ${result.reviewCount} review`);
  }
});