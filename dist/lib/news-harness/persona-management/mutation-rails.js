"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clampWeight = clampWeight;
exports.nudgeTopicWeight = nudgeTopicWeight;
var _config = require("../core/config");
// news-harness — bounded persona-mutation rails (PURE, RN-free).
//
// The math behind every on-device persona nudge: the weight clamp and the
// per-topic per-day nudge budget. The RN adapter
// (lib/database/services/mutation-rails-service.ts) applies the result to
// WatermelonDB; nothing here touches the DB.
//
// Style mirrors the sibling pure file persona-migration.ts / fact-rules.ts:
// plain data in, plain data out, deterministic, config injected (defaults to
// DEFAULT_HARNESS_CONFIG so callers can omit it).

// ── Weight clamp ───────────────────────────────────────────────────────────

/** Clamp a topic weight to the valid [-1, 1] band. */
function clampWeight(w) {
  if (Number.isNaN(w)) return 0;
  return w < -1 ? -1 : w > 1 ? 1 : w;
}

// ── Per-topic per-day nudge budget ─────────────────────────────────────────

/**
 * Apply one nudge to a topic weight under the per-topic per-day budget.
 *
 * remaining      = max(0, NUDGE_DAY_BUDGET − |todayBudgetUsedAbs|)
 * clampedDelta   = clamp(delta, −remaining, +remaining)   ← budget leash
 * before         = clampWeight(currentWeight)
 * after          = clampWeight(before + clampedDelta)     ← ±1 range leash
 * appliedDelta   = after − before
 * budgetExceeded = |clampedDelta| < |delta|
 *
 * When the day's budget is already spent (todayBudgetUsedAbs ≥ budget),
 * remaining is 0 → clampedDelta 0 → appliedDelta 0 (signal recorded elsewhere;
 * the digest decides). budgetExceeded is still true when a non-zero delta was
 * requested.
 */
function nudgeTopicWeight(currentWeight, delta, todayBudgetUsedAbs, config = _config.DEFAULT_HARNESS_CONFIG) {
  const budget = config.mutationRails.NUDGE_DAY_BUDGET;
  const remaining = Math.max(0, budget - Math.abs(todayBudgetUsedAbs));
  const clampedDelta = Math.max(-remaining, Math.min(remaining, delta));
  const before = clampWeight(currentWeight);
  const after = clampWeight(before + clampedDelta);
  const appliedDelta = after - before;
  const budgetExceeded = Math.abs(clampedDelta) < Math.abs(delta);
  return {
    before,
    after,
    appliedDelta,
    requestedDelta: delta,
    budgetExceeded
  };
}