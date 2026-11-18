"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useConfigPanelStore = exports.useConfigPanelIsOpen = exports.useConfigPanelActiveTab = void 0;
var _zustand = require("zustand");
const useConfigPanelStore = exports.useConfigPanelStore = (0, _zustand.create)(set => ({
  isOpen: false,
  activeTab: 'persona',
  openPanel: () => set({
    isOpen: true
  }),
  closePanel: () => set({
    isOpen: false
  }),
  setActiveTab: tab => set({
    activeTab: tab
  })
}));

// Selector hooks for optimized subscriptions
const useConfigPanelIsOpen = () => useConfigPanelStore(state => state.isOpen);
exports.useConfigPanelIsOpen = useConfigPanelIsOpen;
const useConfigPanelActiveTab = () => useConfigPanelStore(state => state.activeTab);
exports.useConfigPanelActiveTab = useConfigPanelActiveTab;