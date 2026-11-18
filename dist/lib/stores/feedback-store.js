"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useFeedbackVisible = exports.useFeedbackStore = void 0;
var _zustand = require("zustand");
// Controls visibility of the "Report a Bug" feedback modal (FeedbackWidgetModal).
// The Preferences "Report a Bug" row routes through showFeedback() in
// lib/feedback.ts, which flips `visible` here. Kept as a tiny in-memory store so
// the modal can live at the app-wide logged-in layout (showing over any screen)
// without prop drilling through the tab tree.

const useFeedbackStore = exports.useFeedbackStore = (0, _zustand.create)(set => ({
  visible: false,
  mounted: false,
  prefilled: false,
  show: opts => set({
    visible: true,
    mounted: true,
    prefilled: !!opts?.prefilled
  }),
  hide: () => set({
    visible: false
  }),
  unmount: () => set({
    mounted: false
  })
}));
const useFeedbackVisible = () => useFeedbackStore(state => state.visible);
exports.useFeedbackVisible = useFeedbackVisible;