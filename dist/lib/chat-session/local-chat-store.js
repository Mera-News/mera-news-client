"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.resetLocalChat = resetLocalChat;
exports.useLocalChatStore = void 0;
var _zustand = require("zustand");
// The on-device chat's live state. It used to be `useState` inside
// useLocalLLM, so closing the chat (which unmounts the view) threw away a turn
// still running on device. In a store it lives with the chat session
// (chat-session.ts) instead, whatever is mounted.

const initialState = {
  messages: [],
  status: 'idle',
  turnBusy: false,
  isBlocked: false,
  blockedReason: null,
  error: null
};
const useLocalChatStore = exports.useLocalChatStore = (0, _zustand.create)(() => ({
  ...initialState
}));
function resetLocalChat() {
  useLocalChatStore.setState({
    ...initialState
  });
}