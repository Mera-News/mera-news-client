"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.removeFactFromTap = removeFactFromTap;
exports.resolveEmptyChatFact = resolveEmptyChatFact;
var _openMeraChat = require("./open-mera-chat");
var _factService = require("../database/services/fact-service");
var _topicGenerationStatusService = require("../database/services/topic-generation-status-service");
var _floatingChatStore = require("../stores/floating-chat-store");
var _chatSession = require("./chat-session");
// A fact accepted in chat whose topic run completed empty. The removal always
// comes before the model is told: with the chat open it happens at once; with
// the chat closed the fact waits, untouched and with no model call, for the
// reader's tap on "See what to save instead".

/** From inside the fact's own topic job, once it settled empty. */
async function resolveEmptyChatFact(factId, statement) {
  if (!(await (0, _factService.chatMayRemoveFact)(factId, statement, {
    inOwnJob: true
  }))) return;
  if (!_floatingChatStore.useFloatingChatStore.getState().isExpanded) {
    await (0, _factService.patchMetadata)(factId, {
      [_topicGenerationStatusService.TOPICS_ASK_REMOVAL]: true
    });
    return;
  }
  if (await (0, _factService.removeFailedChatFact)(factId, statement, {
    inOwnJob: true
  })) (0, _chatSession.noteRemovedFact)(statement);
}
const tapping = new Set();

/**
 * The button. Removes the fact, then opens the chat so Mera can say so. False
 * means something now holds the fact: it stays and the button goes.
 */
async function removeFactFromTap(factId, statement) {
  if (tapping.has(factId)) return false;
  tapping.add(factId);
  try {
    if (!(await (0, _factService.removeFailedChatFact)(factId, statement))) {
      await (0, _factService.patchMetadata)(factId, {
        [_topicGenerationStatusService.TOPICS_ASK_REMOVAL]: undefined
      }).catch(() => {});
      return false;
    }
    (0, _chatSession.noteRemovedFact)(statement);
    if (!_floatingChatStore.useFloatingChatStore.getState().isExpanded) (0, _openMeraChat.openMeraChat)({
      kind: 'persona'
    });
    void (0, _chatSession.flushRemovedFacts)().catch(() => {});
    return true;
  } finally {
    tapping.delete(factId);
  }
}