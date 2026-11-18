"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.__startNewProcessForTests = __startNewProcessForTests;
exports.clearTurnInflight = clearTurnInflight;
exports.deleteInterruptedMessage = deleteInterruptedMessage;
exports.markTurnInflight = markTurnInflight;
exports.recoverInterruptedTurn = recoverInterruptedTurn;
var _conversationService = require("../database/services/conversation-service");
var _settingService = require("../database/services/setting-service");
var _logger = _interopRequireDefault(require("../logger"));
var _floatingChatStore = require("../stores/floating-chat-store");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// A chat turn in flight, on disk. A kill leaves the row behind, and the next
// process turns it into a Retry. The reply itself is out of reach by then: the
// turn's key is memory-only (e2ee-service), so whatever the gateway stored for
// it can no longer be decrypted, and keys are deliberately not persisted.
//
// The text is what the `messages` table already holds. `settings` rows are
// backed up only from an allowlist, and this key is not on it.

const KEY = 'chat_turn_inflight';

/** Tells a dead process's row from this one's, which a recovery run may overlap. */
const newProcessId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let processId = newProcessId();
const warn = error => _logger.default.warn('[ChatSession] turn row write failed', {
  error: String(error)
});
function markTurnInflight(text, contextKind, messageId) {
  (0, _settingService.setSetting)(KEY, JSON.stringify({
    processId,
    text,
    contextKind,
    messageId
  })).catch(warn);
}
function clearTurnInflight() {
  (0, _settingService.deleteSetting)(KEY).catch(warn);
}

/** `inference-recover`: a row from another process is a turn a kill ended. */
async function recoverInterruptedTurn() {
  const raw = await (0, _settingService.getSetting)(KEY);
  if (!raw) return false;
  let row;
  try {
    row = JSON.parse(raw);
  } catch {
    row = {};
  }
  if (row.processId === processId) return false;
  await (0, _settingService.deleteSetting)(KEY);
  if (!row.text || !row.contextKind) return false;
  _floatingChatStore.useFloatingChatStore.getState().setInterruptedTurn({
    text: row.text,
    contextKind: row.contextKind,
    messageId: row.messageId
  });
  return true;
}

/** Retry after a kill sent the message in a new conversation, so the old
 *  conversation's copy goes: history then holds it once. */
function deleteInterruptedMessage(id) {
  (0, _conversationService.deleteMessage)(id).catch(warn);
}

/** Test seam: what a kill does to this module. */
function __startNewProcessForTests() {
  processId = newProcessId();
}