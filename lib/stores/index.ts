// Central store exports and utilities

// Existing stores
export { useForYouStore } from './for-you-store';
export { useUserStore } from './user-store';

// New stores
export { useUIStore, useLogoutModal, useDeleteAccountModal } from './ui-store';
export { useConfigPanelStore, useConfigPanelIsOpen, useConfigPanelActiveTab } from './config-panel-store';
export {
    useFloatingChatStore,
    useFloatingChatIsExpanded,
    useFloatingChatFactMutationVersion,
    useFloatingChatIsGenerating,
} from './floating-chat-store';
export { useAppStateStore, useIsNavigationReady, useIsAppInitialized, useLastAuthenticatedUserId } from './app-state-store';
export { useFeedbackStore, useFeedbackVisible } from './feedback-store';
export {
    useOnboardingStore,
    useOnboardingStep,
    useOnboardingPreferences,
    useOnboardingIsInitializing,
    useOnboardingCompletedSteps,
} from './onboarding-store';
export {
    useMeraProtocolStore,
    useProcessingMode,
    useIsOnDeviceProcessing,
    useModelState,
    useDownloadProgress,
    useIsModelReady,
    useIsProcessing,
    useProcessProgress,
} from './mera-protocol-store';
export {
    useTopicSyncStore,
    useTopicSyncIsSyncing,
    useTopicSyncProgress,
    useTopicSyncError,
} from './topic-sync-store';
export {
    useNetworkStore,
    useIsConnected,
    initNetworkListener,
    stopNetworkListener,
} from './network-store';
export { useTutorialsStore } from './tutorials-store';

// Selectors
export * from './selectors';

// Clear all stores on logout — wipes WatermelonDB + resets Zustand in-memory state
export const clearAllStores = async () => {
    const { resetHostState } = require('../platform/host');
    const database = require('../database').default;
    const { useForYouStore } = require('./for-you-store');
    const { useUserStore } = require('./user-store');
    const { useUIStore } = require('./ui-store');
    const { useAppStateStore } = require('./app-state-store');
    const { useOnboardingStore } = require('./onboarding-store');
    const { useConfigPanelStore } = require('./config-panel-store');
    const { useFloatingChatStore } = require('./floating-chat-store');
    const { useMeraProtocolStore } = require('./mera-protocol-store');
    const { useTopicSyncStore } = require('./topic-sync-store');
    const { useCloudChatStore } = require('./cloud-chat-store');
    const { resetChatSession } = require('../chat-session/chat-session');
    const { useFeedOrderStore } = require('./feed-order-store');
    const { useRelatedSortStore } = require('./related-sort-store');
    const { useTutorialsStore } = require('./tutorials-store');
    const { clearAttestationCache } = require('../e2ee/e2ee-cache');
    const { resetPublisherSourceNames } = require('../database/services/publisher-source-names');

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
    require('../saved-state').resetSavedState();
    clearAttestationCache();
    // Its settings row went with the reset above; the memory must go too, or
    // the next record writes the previous account's publishers into the new
    // account's row.
    resetPublisherSourceNames();
    // The read hold is a memory mirror of a settings row that went with the
    // reset above: without this the next account starts held.
    require('../subscription/read-hold').resetReadHold();

    // LAST, and deliberately so: the host's own state (its subscription
    // store, page orders, navigation memory). The host clears the device's
    // last known subscription tier as its own final step, after every reset
    // here, so a straggling write from the outgoing account cannot land after
    // it.
    await resetHostState();
};
