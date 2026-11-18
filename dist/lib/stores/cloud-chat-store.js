"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useCloudChatStore = void 0;
var _zustand = require("zustand");
// cloud-chat-store — Zustand store for cloud persona chat state.
// Persists across component mount/unmount cycles so remounts don't lose data.

const initialState = {
  messages: [],
  status: 'idle',
  isBlocked: false,
  blockedReason: null,
  error: null,
  interrupted: false,
  wireMessages: [],
  agentTurnState: null,
  agentTerminal: null
};
const useCloudChatStore = exports.useCloudChatStore = (0, _zustand.create)((set, get) => ({
  ...initialState,
  setMessages: messagesOrUpdater => set(state => ({
    messages: typeof messagesOrUpdater === 'function' ? messagesOrUpdater(state.messages) : messagesOrUpdater
  })),
  setStatus: status => set({
    status
  }),
  setIsBlocked: blocked => set({
    isBlocked: blocked
  }),
  setBlockedReason: reason => set({
    blockedReason: reason
  }),
  setError: error => set({
    error
  }),
  setInterrupted: interrupted => set({
    interrupted
  }),
  setAgentTurnState: agentTurnState => set({
    agentTurnState
  }),
  setAgentTerminal: agentTerminal => set({
    agentTerminal
  }),
  pushWireMessage: msg => set(state => ({
    wireMessages: [...state.wireMessages, msg]
  })),
  getWireMessages: () => get().wireMessages,
  reset: () => set({
    ...initialState
  })
}));