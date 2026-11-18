"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.renderableTerminal = renderableTerminal;
// Floating-chat presentational contracts.
//
// These types are the shared vocabulary between the pure `deriveThreadItems`
// util, the ChatThread component, and the (parallel) data/store layer that
// feeds it. Everything here is presentational — no data fetching, no stores.

// ---------------------------------------------------------------------------
// PersistedMessage
// ---------------------------------------------------------------------------
// Re-exported from the conversation service (the single source of truth) so
// existing `./types` importers keep working.

// ---------------------------------------------------------------------------
// Thread items
// ---------------------------------------------------------------------------

/** The user's own sentence as a fact, offered by the loop. */

/**
 * Where a follow card's state lives: the proposeTrack call's override key, its
 * staged result (the merge base on the first write, the override store holds
 * overrides only), and what the override already says.
 */

/** What a pending removal card's Remove / Keep acts on. */

// ---------------------------------------------------------------------------
// Agent steps
// ---------------------------------------------------------------------------

/**
 * The loop terminals that are worth a sentence on screen.
 *
 * A subset of the loop's own `terminalReason`: `settled` and `awaiting-user`
 * are ordinary, and `transport-error` already has the error banner. These four
 * are the ones where the user is otherwise left looking at a turn that appears
 * to have finished and did not.
 */

/**
 * EVERY terminal the loop can produce, classified exhaustively.
 *
 * Typed as a Record over the loop's own union, so a terminal added there does
 * not compile until someone decides whether the user is told about it. That
 * matters because the failure mode is SILENCE, not a wrong message:
 * `malformed-choice` was missing from the old hand-written list, and when it
 * fired the loop set no pendingChoice (no chips), no proposal (no card) and the
 * box rendered "Done". A user who said "I live in Nieuw-West Amsterdam", the
 * ambiguous-place case that reaches ask_choice, saw the steps finish and then
 * nothing at all. Shipped to production in update group 7b3f77d3.
 *
 * `null` means the turn ended normally and needs no sentence: `settled` and
 * `awaiting-user` are ordinary, and `transport-error` already has the error
 * banner.
 */
const TERMINAL_CLASS = {
  settled: null,
  'awaiting-user': null,
  'transport-error': null,
  'leg-cap': 'leg-cap',
  'no-route': 'no-route',
  'no-proposal': 'no-proposal',
  'unknown-tool': 'unknown-tool',
  'malformed-choice': 'malformed-choice'
};

/** The loop's `terminalReason` narrowed to what the thread renders. */
function renderableTerminal(reason) {
  if (!reason) return null;
  return TERMINAL_CLASS[reason] ?? null;
}

/**
 * One row in the agent-steps box: a leg beginning, or one tool call.
 *
 * Derived from `ToolCallRecord.status`, which is the ONLY item kind here that
 * reads a tool call's status rather than its result. That is why it can render
 * while work is still in flight, and why `deriveThreadItems` has to push it
 * before the "empty assistant message with no cards" guard.
 *
 * `labelKey` and `consequenceKey` are plain strings, not literal unions. The
 * literals live at the ONE place they are resolved — AgentStepsBox's key
 * tables — because `t()`'s generated overloads pin the option shape per key,
 * so a union of keys cannot be passed to it. Putting the literals in the
 * `t()` calls is what makes tsc prove every key reached the dictionaries.
 */

// ---------------------------------------------------------------------------
// Starter chips
// ---------------------------------------------------------------------------

/** An onboarding button above the composer. It runs its own handler, so a tap
 *  that must cost no model call never reaches the send path. */

// ---------------------------------------------------------------------------
// ChatThread props
// ---------------------------------------------------------------------------