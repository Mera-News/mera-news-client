"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useTopicSyncStore = exports.useTopicSyncProgress = exports.useTopicSyncIsSyncing = exports.useTopicSyncError = void 0;
var _zustand = require("zustand");
var _shallow = require("zustand/react/shallow");
const useTopicSyncStore = exports.useTopicSyncStore = (0, _zustand.create)(set => ({
  isSyncing: false,
  total: 0,
  completed: 0,
  error: null,
  startSync: total => set({
    isSyncing: true,
    total,
    completed: 0,
    error: null
  }),
  incrementCompleted: () => set(state => ({
    completed: state.completed + 1
  })),
  setError: error => set({
    error
  }),
  finishSync: () => set({
    isSyncing: false
  }),
  reset: () => set({
    isSyncing: false,
    total: 0,
    completed: 0,
    error: null
  })
}));
const useTopicSyncIsSyncing = () => useTopicSyncStore(state => state.isSyncing);
exports.useTopicSyncIsSyncing = useTopicSyncIsSyncing;
const useTopicSyncProgress = () => useTopicSyncStore((0, _shallow.useShallow)(state => ({
  total: state.total,
  completed: state.completed
})));
exports.useTopicSyncProgress = useTopicSyncProgress;
const useTopicSyncError = () => useTopicSyncStore(state => state.error);
exports.useTopicSyncError = useTopicSyncError;