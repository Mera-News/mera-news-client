"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isPaidTier = isPaidTier;
exports.resolvePlanDisplay = resolvePlanDisplay;
/**
 * ONE rule for "what plan does this screen claim the user is on".
 *
 * ## The bug this exists to make impossible
 *
 * The Profile screen could show "Individual Plan" in its usage card and, two
 * inches below, a free-tier notice saying it cannot build a feed without a
 * plan. Both were correct by their own rule, and that was the problem — there
 * were two rules:
 *
 *   - the LABEL took `serverTier`, falling back to RevenueCat's client-side
 *     tier when the server said `none`. That fallback is deliberate and was
 *     added for a good reason: for the few seconds between a purchase and the
 *     webhook landing, it shows the plan the user just bought instead of
 *     "Free plan", and keeps Profile and Manage-subscription agreeing.
 *   - the GATE (`deriveAiAccess`) consults `serverTier` FIRST and returns
 *     `locked` whenever it is `none`, with NO RevenueCat fallback — because the
 *     device must never be able to grant itself a paid tier.
 *
 * Normally those disagree for seconds. When the webhook can never land — a
 * sandbox purchase on a production build, whose receipt RevenueCat routes to
 * staging — they disagree forever, and the screen contradicts itself.
 *
 * ## What this does about it
 *
 * It keeps the optimistic fallback, because losing it would make every real
 * purchase read "Free plan" for a few seconds. What it removes is the label's
 * ability to state that optimism as FACT. When the label is running on the
 * RevenueCat fallback the result is marked `pending`, and callers render it as
 * "activating" rather than as a plan the app is honouring. The gate is
 * unchanged and stays the only authority on access.
 *
 * Both screens import this. Neither re-derives it.
 */

const PAID_TIERS = ['starter', 'individual', 'professional'];
function isPaidTier(tier) {
  return tier != null && PAID_TIERS.includes(tier);
}
function resolvePlanDisplay({
  serverTier,
  rcTier,
  serverLoaded
}) {
  if (!serverLoaded) return {
    tier: null,
    pending: false,
    known: false
  };

  // The server answers `starter` for every unpaid account, so a store tier
  // ABOVE it is a fresh purchase the webhook has not reached yet: pending.
  if (isPaidTier(rcTier) && PAID_TIERS.indexOf(rcTier) > PAID_TIERS.indexOf(serverTier ?? '')) {
    return {
      tier: rcTier,
      pending: true,
      known: true
    };
  }

  // The server confirmed a paid tier: plain, unqualified truth.
  if (isPaidTier(serverTier)) {
    return {
      tier: serverTier,
      pending: false,
      known: true
    };
  }

  // The server says no, but the store says yes. Name the plan so a
  // just-completed purchase is visible, and mark it pending so nothing
  // presents it as access the user actually has.
  if (isPaidTier(rcTier)) {
    return {
      tier: rcTier,
      pending: true,
      known: true
    };
  }
  return {
    tier: null,
    pending: false,
    known: true
  };
}