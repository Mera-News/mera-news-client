"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  clearAllStores: true,
  useForYouStore: true,
  useUserStore: true,
  useUIStore: true,
  useLogoutModal: true,
  useDeleteAccountModal: true,
  useConfigPanelStore: true,
  useConfigPanelIsOpen: true,
  useConfigPanelActiveTab: true,
  useFloatingChatStore: true,
  useFloatingChatIsExpanded: true,
  useFloatingChatFactMutationVersion: true,
  useFloatingChatIsGenerating: true,
  useAppStateStore: true,
  useIsNavigationReady: true,
  useIsAppInitialized: true,
  useLastAuthenticatedUserId: true,
  useFeedbackStore: true,
  useFeedbackVisible: true,
  useOnboardingStore: true,
  useOnboardingStep: true,
  useOnboardingPreferences: true,
  useOnboardingIsInitializing: true,
  useOnboardingCompletedSteps: true,
  useMeraProtocolStore: true,
  useProcessingMode: true,
  useIsOnDeviceProcessing: true,
  useModelState: true,
  useDownloadProgress: true,
  useIsModelReady: true,
  useIsProcessing: true,
  useProcessProgress: true,
  useTopicSyncStore: true,
  useTopicSyncIsSyncing: true,
  useTopicSyncProgress: true,
  useTopicSyncError: true,
  useNetworkStore: true,
  useIsConnected: true,
  initNetworkListener: true,
  stopNetworkListener: true,
  useTutorialsStore: true
};
exports.clearAllStores = void 0;
Object.defineProperty(exports, "initNetworkListener", {
  enumerable: true,
  get: function () {
    return _networkStore.initNetworkListener;
  }
});
Object.defineProperty(exports, "stopNetworkListener", {
  enumerable: true,
  get: function () {
    return _networkStore.stopNetworkListener;
  }
});
Object.defineProperty(exports, "useAppStateStore", {
  enumerable: true,
  get: function () {
    return _appStateStore.useAppStateStore;
  }
});
Object.defineProperty(exports, "useConfigPanelActiveTab", {
  enumerable: true,
  get: function () {
    return _configPanelStore.useConfigPanelActiveTab;
  }
});
Object.defineProperty(exports, "useConfigPanelIsOpen", {
  enumerable: true,
  get: function () {
    return _configPanelStore.useConfigPanelIsOpen;
  }
});
Object.defineProperty(exports, "useConfigPanelStore", {
  enumerable: true,
  get: function () {
    return _configPanelStore.useConfigPanelStore;
  }
});
Object.defineProperty(exports, "useDeleteAccountModal", {
  enumerable: true,
  get: function () {
    return _uiStore.useDeleteAccountModal;
  }
});
Object.defineProperty(exports, "useDownloadProgress", {
  enumerable: true,
  get: function () {
    return _meraProtocolStore.useDownloadProgress;
  }
});
Object.defineProperty(exports, "useFeedbackStore", {
  enumerable: true,
  get: function () {
    return _feedbackStore.useFeedbackStore;
  }
});
Object.defineProperty(exports, "useFeedbackVisible", {
  enumerable: true,
  get: function () {
    return _feedbackStore.useFeedbackVisible;
  }
});
Object.defineProperty(exports, "useFloatingChatFactMutationVersion", {
  enumerable: true,
  get: function () {
    return _floatingChatStore.useFloatingChatFactMutationVersion;
  }
});
Object.defineProperty(exports, "useFloatingChatIsExpanded", {
  enumerable: true,
  get: function () {
    return _floatingChatStore.useFloatingChatIsExpanded;
  }
});
Object.defineProperty(exports, "useFloatingChatIsGenerating", {
  enumerable: true,
  get: function () {
    return _floatingChatStore.useFloatingChatIsGenerating;
  }
});
Object.defineProperty(exports, "useFloatingChatStore", {
  enumerable: true,
  get: function () {
    return _floatingChatStore.useFloatingChatStore;
  }
});
Object.defineProperty(exports, "useForYouStore", {
  enumerable: true,
  get: function () {
    return _forYouStore.useForYouStore;
  }
});
Object.defineProperty(exports, "useIsAppInitialized", {
  enumerable: true,
  get: function () {
    return _appStateStore.useIsAppInitialized;
  }
});
Object.defineProperty(exports, "useIsConnected", {
  enumerable: true,
  get: function () {
    return _networkStore.useIsConnected;
  }
});
Object.defineProperty(exports, "useIsModelReady", {
  enumerable: true,
  get: function () {
    return _meraProtocolStore.useIsModelReady;
  }
});
Object.defineProperty(exports, "useIsNavigationReady", {
  enumerable: true,
  get: function () {
    return _appStateStore.useIsNavigationReady;
  }
});
Object.defineProperty(exports, "useIsOnDeviceProcessing", {
  enumerable: true,
  get: function () {
    return _meraProtocolStore.useIsOnDeviceProcessing;
  }
});
Object.defineProperty(exports, "useIsProcessing", {
  enumerable: true,
  get: function () {
    return _meraProtocolStore.useIsProcessing;
  }
});
Object.defineProperty(exports, "useLastAuthenticatedUserId", {
  enumerable: true,
  get: function () {
    return _appStateStore.useLastAuthenticatedUserId;
  }
});
Object.defineProperty(exports, "useLogoutModal", {
  enumerable: true,
  get: function () {
    return _uiStore.useLogoutModal;
  }
});
Object.defineProperty(exports, "useMeraProtocolStore", {
  enumerable: true,
  get: function () {
    return _meraProtocolStore.useMeraProtocolStore;
  }
});
Object.defineProperty(exports, "useModelState", {
  enumerable: true,
  get: function () {
    return _meraProtocolStore.useModelState;
  }
});
Object.defineProperty(exports, "useNetworkStore", {
  enumerable: true,
  get: function () {
    return _networkStore.useNetworkStore;
  }
});
Object.defineProperty(exports, "useOnboardingCompletedSteps", {
  enumerable: true,
  get: function () {
    return _onboardingStore.useOnboardingCompletedSteps;
  }
});
Object.defineProperty(exports, "useOnboardingIsInitializing", {
  enumerable: true,
  get: function () {
    return _onboardingStore.useOnboardingIsInitializing;
  }
});
Object.defineProperty(exports, "useOnboardingPreferences", {
  enumerable: true,
  get: function () {
    return _onboardingStore.useOnboardingPreferences;
  }
});
Object.defineProperty(exports, "useOnboardingStep", {
  enumerable: true,
  get: function () {
    return _onboardingStore.useOnboardingStep;
  }
});
Object.defineProperty(exports, "useOnboardingStore", {
  enumerable: true,
  get: function () {
    return _onboardingStore.useOnboardingStore;
  }
});
Object.defineProperty(exports, "useProcessProgress", {
  enumerable: true,
  get: function () {
    return _meraProtocolStore.useProcessProgress;
  }
});
Object.defineProperty(exports, "useProcessingMode", {
  enumerable: true,
  get: function () {
    return _meraProtocolStore.useProcessingMode;
  }
});
Object.defineProperty(exports, "useTopicSyncError", {
  enumerable: true,
  get: function () {
    return _topicSyncStore.useTopicSyncError;
  }
});
Object.defineProperty(exports, "useTopicSyncIsSyncing", {
  enumerable: true,
  get: function () {
    return _topicSyncStore.useTopicSyncIsSyncing;
  }
});
Object.defineProperty(exports, "useTopicSyncProgress", {
  enumerable: true,
  get: function () {
    return _topicSyncStore.useTopicSyncProgress;
  }
});
Object.defineProperty(exports, "useTopicSyncStore", {
  enumerable: true,
  get: function () {
    return _topicSyncStore.useTopicSyncStore;
  }
});
Object.defineProperty(exports, "useTutorialsStore", {
  enumerable: true,
  get: function () {
    return _tutorialsStore.useTutorialsStore;
  }
});
Object.defineProperty(exports, "useUIStore", {
  enumerable: true,
  get: function () {
    return _uiStore.useUIStore;
  }
});
Object.defineProperty(exports, "useUserStore", {
  enumerable: true,
  get: function () {
    return _userStore.useUserStore;
  }
});
var _forYouStore = require("./for-you-store");
var _userStore = require("./user-store");
var _uiStore = require("./ui-store");
var _configPanelStore = require("./config-panel-store");
var _floatingChatStore = require("./floating-chat-store");
var _appStateStore = require("./app-state-store");
var _feedbackStore = require("./feedback-store");
var _onboardingStore = require("./onboarding-store");
var _meraProtocolStore = require("./mera-protocol-store");
var _topicSyncStore = require("./topic-sync-store");
var _networkStore = require("./network-store");
var _tutorialsStore = require("./tutorials-store");
var _selectors = require("./selectors");
Object.keys(_selectors).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _selectors[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _selectors[key];
    }
  });
});
// Central store exports and utilities

// Existing stores

// New stores

// Selectors

// Clear all stores on logout — wipes WatermelonDB + resets Zustand in-memory state
const clearAllStores = async () => {
  const {
    resetHostState
  } = require("../platform/host");
  const database = require("../database").default;
  const {
    useForYouStore
  } = require("./for-you-store");
  const {
    useUserStore
  } = require("./user-store");
  const {
    useUIStore
  } = require("./ui-store");
  const {
    useAppStateStore
  } = require("./app-state-store");
  const {
    useOnboardingStore
  } = require("./onboarding-store");
  const {
    useConfigPanelStore
  } = require("./config-panel-store");
  const {
    useFloatingChatStore
  } = require("./floating-chat-store");
  const {
    useMeraProtocolStore
  } = require("./mera-protocol-store");
  const {
    useTopicSyncStore
  } = require("./topic-sync-store");
  const {
    useCloudChatStore
  } = require("./cloud-chat-store");
  const {
    resetChatSession
  } = require("../chat-session/chat-session");
  const {
    useFeedOrderStore
  } = require("./feed-order-store");
  const {
    useRelatedSortStore
  } = require("./related-sort-store");
  const {
    useTutorialsStore
  } = require("./tutorials-store");
  const {
    clearAttestationCache
  } = require("../e2ee/e2ee-cache");
  const {
    resetPublisherSourceNames
  } = require("../database/services/publisher-source-names");

  // Work the previous person left waiting goes first: a mute's purge would otherwise run in the
  // next account's database, and a paired phone's unsent display marks are theirs too.
  require("../database/services/publication-pref-ui-actions").cancelPendingPurges();
  require("../sync/marks").defaultMarkBatch.takeBatch();

  // Wipe all WatermelonDB data (drops and recreates all tables)
  await database.write(async () => {
    await database.unsafeResetDatabase();
  });

  // Reset all Zustand in-memory state
  useForYouStore.getState().clearData();
  useUserStore.getState().clearUser();
  useUIStore.getState().resetUIState();
  useAppStateStore.getState().resetAppState();
  useOnboardingStore.getState().resetOnboarding();
  useConfigPanelStore.getState().closePanel();
  useFloatingChatStore.getState().reset();
  useMeraProtocolStore.getState().reset();
  useTopicSyncStore.getState().reset();
  useCloudChatStore.getState().reset();
  // The on-device chat thread lives in the session service's memory, not a
  // store: drop it, or the next account reads the previous one's turns.
  resetChatSession();
  useFeedOrderStore.getState().reset();
  useRelatedSortStore.getState().reset();
  // Tutorial progress is per-DEVICE-USER, not per-account-in-the-abstract: the
  // settings rows go with the database wipe above, so the in-memory ticks must
  // go too or the next user on this phone inherits a finished tour.
  useTutorialsStore.getState().reset();
  // The saved flags are module memory; the rows went with the database.
  require("../saved-state").resetSavedState();
  clearAttestationCache();
  // Its settings row went with the reset above; the memory must go too, or
  // the next record writes the previous account's publishers into the new
  // account's row.
  resetPublisherSourceNames();
  // The read hold is a memory mirror of a settings row that went with the
  // reset above: without this the next account starts held.
  require("../subscription/read-hold").resetReadHold();

  // LAST, and deliberately so: the host's own state (its subscription
  // store, page orders, navigation memory). The host clears the device's
  // last known subscription tier as its own final step, after every reset
  // here, so a straggling write from the outgoing account cannot land after
  // it.
  await resetHostState();
};
exports.clearAllStores = clearAllStores;