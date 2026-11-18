"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isOnboardingMenuRow = exports.MUTATING_CHAT_TOOLS = exports.MAX_FOLLOW_OPTIONS = void 0;
exports.scriptedRowIds = scriptedRowIds;
// What a chat engine (cloud or on-device) offers the chat session. Engines
// are plain closures over their own turn state and write to their store; no
// component owns them, so closing the chat never ends a turn.

/** The most options a follow card may hold, grown ones included. */
const MAX_FOLLOW_OPTIONS = exports.MAX_FOLLOW_OPTIONS = 8;

/** Tools that change the reader's data or a card's outcome when they run. A turn
 *  that ran one is never retried. Staging tools (saveExtractedFacts, proposeTrack,
 *  proposeChanges, proposeFactCheck) write nothing, so a repeat is harmless. */
const MUTATING_CHAT_TOOLS = exports.MUTATING_CHAT_TOOLS = new Set(['applyProposal', 'cancelProposal', 'deleteUserFacts', 'updateUserConfig', 'issueWarning', 'runCalibration']);

/** What rides one send. Held nowhere else, so nothing needs clearing. */

/** An onboarding line: no model call and no turn. The next real turn reads it. */

/** The marker is the id, because the id is what `messages` keeps and resume returns. */
const MENU_ROW_SUFFIX = '-onboarding-menu';
const isOnboardingMenuRow = id => id.endsWith(MENU_ROW_SUFFIX);

/** Ids for one exchange. Rows written in one tick can share a timestamp, and the
 *  table then orders by id, so these sort reader first ("a" before "b" and "o"). */
exports.isOnboardingMenuRow = isOnboardingMenuRow;
function scriptedRowIds(menu) {
  const base = `scripted-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    user: `${base}-a`,
    assistant: menu ? `${base}${MENU_ROW_SUFFIX}` : `${base}-b`
  };
}

/** "More options" on a follow card, built from the card alone (`requestMoreOptions`). */

/** Never thrown: an empty `actions` always carries a reason. */

/** A turn from a dead process. `heldMessageId`: this thread already shows its message. */

/** `A` is the agent kind the engine runs: IAgent on cloud, OnDeviceAgent on the phone. */