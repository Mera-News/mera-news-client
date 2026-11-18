"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useUIStore = exports.useLogoutModal = exports.useDeleteAccountModal = void 0;
var _zustand = require("zustand");
const initialModalState = {
  logout: {
    isOpen: false,
    isProcessing: false
  },
  deleteAccount: {
    isOpen: false,
    step: 'initial',
    isProcessing: false
  }
};
const useUIStore = exports.useUIStore = (0, _zustand.create)(set => ({
  modals: initialModalState,
  openModal: modal => set(state => ({
    modals: {
      ...state.modals,
      [modal]: {
        ...state.modals[modal],
        isOpen: true,
        // Reset step to initial when opening deleteAccount modal
        ...(modal === 'deleteAccount' ? {
          step: 'initial'
        } : {})
      }
    }
  })),
  closeModal: modal => set(state => ({
    modals: {
      ...state.modals,
      [modal]: {
        ...state.modals[modal],
        isOpen: false,
        isProcessing: false,
        // Reset step when closing deleteAccount modal
        ...(modal === 'deleteAccount' ? {
          step: 'initial'
        } : {})
      }
    }
  })),
  setDeleteAccountStep: step => set(state => ({
    modals: {
      ...state.modals,
      deleteAccount: {
        ...state.modals.deleteAccount,
        step
      }
    }
  })),
  setModalProcessing: (modal, isProcessing) => set(state => ({
    modals: {
      ...state.modals,
      [modal]: {
        ...state.modals[modal],
        isProcessing
      }
    }
  })),
  resetUIState: () => set({
    modals: initialModalState
  })
}));

// Selector hooks for optimized subscriptions
const useLogoutModal = () => useUIStore(state => state.modals.logout);
exports.useLogoutModal = useLogoutModal;
const useDeleteAccountModal = () => useUIStore(state => state.modals.deleteAccount);
exports.useDeleteAccountModal = useDeleteAccountModal;