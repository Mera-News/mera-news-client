"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.commitAsWritten = commitAsWritten;
exports.commitSaveAsWritten = commitSaveAsWritten;
exports.confirmPendingDelete = confirmPendingDelete;
exports.resolveGroup = resolveGroup;
exports.resolveGroups = resolveGroups;
var _conversationService = require("../../database/services/conversation-service");
var _factChoiceResolution = require("../../chat-tools/fact-choice-resolution");
var _logger = _interopRequireDefault(require("../../logger"));
var _factCommit = require("../../chat-tools/fact-commit");
var _toolHandlers = require("../../chat-tools/tool-handlers");
var _floatingChatStore = require("../../stores/floating-chat-store");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// fact-choice-actions — the SIDE-EFFECT half of per-group fact-choice state.
//
// Sibling of topic-plan-actions.ts, and the same contract: the card requests, a
// single tested module decides and writes. Every write to a fact-choice tool
// result goes through `resolveGroup` below, so the in-memory and durable halves
// can never disagree and no card owns its own merge logic.
//
// THE MERGE MUST READ THE STORE, NEVER A RENDER-TIME CLOSURE. Two fast taps on
// two different cards both resolve into the SAME blob, and a card that merged
// into the `toolCallResults` value it captured at render would write back a blob
// missing whatever the other tap had just committed — silently losing a saved
// fact. The snapshot below is taken with `getState()` immediately before the
// `set`, with no `await` between them, so nothing can interleave: JS is single
// threaded and zustand's `set` is synchronous. Anything async (the actual fact
// commit) happens BEFORE this function is called, never inside the window.

/**
 * Apply one group's outcome to the tool result at `resultKey`.
 *
 * `resolution === undefined` removes the entry, which is how Undo returns a
 * dismissed group to pending.
 *
 * The durable half is fire-and-forget on purpose: a missing message row is NOT
 * an error (an assistant message persists only once the turn finalises, so a
 * fast tap can land first) and the chat session (lib/chat-session) merges the store override in
 * at write time to close that race. Failing the tap because the row is not there
 * yet would be a regression against a race the persistence layer already
 * handles.
 */
function resolveGroup(resultKey, groupId, resolution, baseResult) {
  const store = _floatingChatStore.useFloatingChatStore.getState();
  // READ -> MERGE -> WRITE, synchronously. See the module header.
  //
  // `baseResult` is the tool call's OWN staged result, and it is required, not a
  // convenience. The store holds OVERRIDES ONLY: on the first tap of a turn
  // there is no entry at `resultKey` at all, because the staged blob lives on
  // `message.toolCalls[idx].result` and nothing has copied it across. Merging
  // into `undefined` produced a blob whose spine was empty, the deriver applied
  // it as the whole result, found no groups and emitted NO CARDS — every card in
  // the turn vanished on the first tap, with the fact still saved because the
  // commit had already run. Falling back to the staged result is what makes the
  // first merge and every later one identical.
  const current = store.toolCallResults[resultKey] ?? baseResult;
  const next = (0, _factChoiceResolution.mergeGroupResolution)(current, groupId, resolution);
  store.setToolCallResult(resultKey, next);
  const [messageId, indexRaw] = resultKey.split('::');
  const index = Number(indexRaw);
  if (messageId && Number.isInteger(index)) {
    void (0, _conversationService.patchMessageToolCallResult)(messageId, index, next).catch(err => {
      _logger.default.warn('[fact-choice] durable patch failed', {
        resultKey,
        groupId,
        error: String(err)
      });
      return false;
    });
  }
  return next;
}

/**
 * Apply SEVERAL groups' outcomes in one pass.
 *
 * "Add all" and "Skip all" resolve N groups at once, and doing that as N calls
 * to `resolveGroup` would be N store writes, N re-renders and N durable patches
 * for one user tap. Folding them through `mergeGroupResolution` in a single
 * read-modify-write also means the fully-resolved rewrite fires exactly once,
 * on the final merge, rather than being evaluated against N-1 partial states.
 */
function resolveGroups(resultKey, entries, baseResult) {
  const store = _floatingChatStore.useFloatingChatStore.getState();
  // Same required fallback as resolveGroup: "Add all" is usually the FIRST
  // resolution of the turn, so the store entry is the one that does not exist.
  let next = store.toolCallResults[resultKey] ?? baseResult;
  for (const entry of entries) {
    next = (0, _factChoiceResolution.mergeGroupResolution)(next, entry.groupId, entry.resolution);
  }
  const settled = next ?? {};
  store.setToolCallResult(resultKey, settled);
  const [messageId, indexRaw] = resultKey.split('::');
  const index = Number(indexRaw);
  if (messageId && Number.isInteger(index)) {
    void (0, _conversationService.patchMessageToolCallResult)(messageId, index, settled).catch(err => {
      _logger.default.warn('[fact-choice] durable batch patch failed', {
        resultKey,
        error: String(err)
      });
      return false;
    });
  }
  return settled;
}

/** The sentences as written, each with its key and topic guideline. */
async function commitAsWritten(entries) {
  const {
    savedFacts
  } = await (0, _factCommit.commitFactChoices)(entries.map(entry => ({
    statement: entry.statement,
    ...(entry.questionnaire_attribute ? {
      questionnaire: {
        attribute: entry.questionnaire_attribute
      }
    } : {}),
    ...(entry.topic_skill_id ? {
      skillId: entry.topic_skill_id
    } : {})
  })));
  return savedFacts;
}

/**
 * "Save as I wrote it": commit the user's own sentence, then record
 * the saved fact on the offering call's result so the thread swaps the chip
 * for a Saved card and its topics. It goes through `commitFactChoices`, so topic
 * minting and geo derivation run as for any accepted fact, and the model never
 * sees the tap. Same store-then-durable shape as `resolveGroup`.
 */
async function commitSaveAsWritten(offer) {
  const {
    entry,
    resultKey,
    baseResult
  } = offer;
  try {
    const savedFacts = await commitAsWritten([entry]);
    const store = _floatingChatStore.useFloatingChatStore.getState();
    const current = store.toolCallResults[resultKey] ?? baseResult;
    const next = {
      ...current,
      saveAsWrittenSaved: savedFacts
    };
    store.setToolCallResult(resultKey, next);
    const [messageId, indexRaw] = resultKey.split('::');
    const index = Number(indexRaw);
    if (messageId && Number.isInteger(index)) {
      void (0, _conversationService.patchMessageToolCallResult)(messageId, index, next).catch(err => {
        _logger.default.warn('[fact-choice] save-as-written patch failed', {
          resultKey,
          error: String(err)
        });
        return false;
      });
    }
  } catch (err) {
    _logger.default.error('[fact-choice] save as written failed', err, {
      resultKey
    });
  }
}

/**
 * The removal card's Remove or Keep (owner-approved). Remove
 * deletes exactly the listed facts through the ordinary handler, with no model
 * turn; either way the outcome is recorded on the call's result, which is what
 * turns the card into "Removed from your persona" or "Nothing was removed."
 */
async function confirmPendingDelete(pending, choice) {
  const {
    resultKey,
    baseResult,
    factIds
  } = pending;
  try {
    let outcome = {
      deleteOutcome: 'kept'
    };
    if (choice === 'remove') {
      const out = await (0, _toolHandlers.handleDeleteUserFacts)({
        fact_ids: factIds
      });
      outcome = {
        deleteOutcome: 'removed',
        deletedStatements: Array.isArray(out.deletedStatements) ? out.deletedStatements : [],
        deletedCount: typeof out.deletedCount === 'number' ? out.deletedCount : 0
      };
    }
    const store = _floatingChatStore.useFloatingChatStore.getState();
    const current = store.toolCallResults[resultKey] ?? baseResult;
    const next = {
      ...current,
      ...outcome
    };
    store.setToolCallResult(resultKey, next);
    const [messageId, indexRaw] = resultKey.split('::');
    const index = Number(indexRaw);
    if (messageId && Number.isInteger(index)) {
      void (0, _conversationService.patchMessageToolCallResult)(messageId, index, next).catch(err => {
        _logger.default.warn('[fact-choice] delete outcome patch failed', {
          resultKey,
          error: String(err)
        });
        return false;
      });
    }
  } catch (err) {
    _logger.default.error('[fact-choice] removal failed', err, {
      resultKey
    });
  }
}