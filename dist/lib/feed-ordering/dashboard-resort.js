"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DASHBOARD_RESORT_INTERVAL_MS = exports.DASHBOARD_RESORT_INTERVAL_MINUTES = void 0;
exports.msUntilResortDue = msUntilResortDue;
exports.shouldResort = shouldResort;
// dashboard-resort — WHEN the Dashboard is allowed to re-sort its sections.
//
// PURE and RN-free (the screen owns the timers and the React state; this owns
// only the decision), so the policy is unit-testable without a device.
//
// The problem: the Dashboard applies the same unviewed→viewed priority order as
// the Feed, but unlike the Feed it is a browsing surface the user scans
// repeatedly. Re-sorting on every focus or every render would reshuffle sections
// under the reader's eyes each time they glanced away — the exact "where did it
// go?" complaint the Feed's snapshot mechanism exists to prevent.
//
// The rule: re-sort at most once per DASHBOARD_RESORT_INTERVAL_MINUTES, and
// prefer to apply it while the user is NOT watching (tab blurred / app
// backgrounded). If they keep watching past the interval, applying at the mark
// is accepted — the alternative is an order that never converges.

/** How long a sort snapshot is held before it may be replaced. */
const DASHBOARD_RESORT_INTERVAL_MINUTES = exports.DASHBOARD_RESORT_INTERVAL_MINUTES = 10;
const DASHBOARD_RESORT_INTERVAL_MS = exports.DASHBOARD_RESORT_INTERVAL_MS = DASHBOARD_RESORT_INTERVAL_MINUTES * 60_000;

/** Why a re-sort is being considered. `unwatched` = the user just stopped
 *  looking (tab blur / app background); `elapsed` = the interval timer fired
 *  while they were still looking. */

/**
 * Should the Dashboard replace its sort snapshot now?
 *
 * - Never applied yet ⇒ yes (the first snapshot must seed).
 * - Interval not elapsed ⇒ no, whatever the trigger. This is what stops a
 *   tab-switch loop from reshuffling the list every few seconds.
 * - Interval elapsed ⇒ yes, for BOTH triggers: `unwatched` is the preferred
 *   moment, and `elapsed` is the accepted fallback for a user who never looks
 *   away.
 */
function shouldResort({
  lastAppliedMs,
  nowMs,
  intervalMs = DASHBOARD_RESORT_INTERVAL_MS
}) {
  if (lastAppliedMs === null) return true;
  return nowMs - lastAppliedMs >= intervalMs;
}

/** Milliseconds until the interval elapses (0 when it already has). Drives the
 *  screen's single pending timer, so it fires exactly at the mark rather than
 *  polling. */
function msUntilResortDue(lastAppliedMs, nowMs, intervalMs = DASHBOARD_RESORT_INTERVAL_MS) {
  if (lastAppliedMs === null) return 0;
  return Math.max(0, lastAppliedMs + intervalMs - nowMs);
}