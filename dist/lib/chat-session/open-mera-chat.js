"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.openMeraChat = openMeraChat;
var _floatingChatStore = require("../stores/floating-chat-store");
// openMeraChat: open the Mera chat on a context, optionally with text waiting
// in the composer. A draft is never sent: the reader edits it and taps Send,
// so a starter costs no model call (owner ruling). Use
// `openArticleFeedback` only where a turn really must be auto-sent.

function openMeraChat(context, opts = {}) {
  _floatingChatStore.useFloatingChatStore.getState().expand(context, opts);
}