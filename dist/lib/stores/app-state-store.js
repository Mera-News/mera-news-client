"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useLastAuthenticatedUserId = exports.useIsNavigationReady = exports.useIsAppInitialized = exports.useAppStateStore = void 0;
var _zustand = require("zustand");
var _settingService = require("../database/services/setting-service");
var _logger = _interopRequireDefault(require("../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const initialState = {
  isNavigationReady: false,
  isAppInitialized: false,
  lastAuthenticatedUserId: null
};
const useAppStateStore = exports.useAppStateStore = (0, _zustand.create)(set => ({
  ...initialState,
  setNavigationReady: ready => set({
    isNavigationReady: ready
  }),
  setAppInitialized: initialized => set({
    isAppInitialized: initialized
  }),
  setLastAuthenticatedUserId: userId => {
    set({
      lastAuthenticatedUserId: userId
    });
    if (userId) {
      (0, _settingService.setSetting)('last_authenticated_user_id', userId).catch(() => {});
    } else {
      (0, _settingService.deleteSetting)('last_authenticated_user_id').catch(() => {});
    }
  },
  resetAppState: () => set(initialState),
  hydrateFromDb: async () => {
    try {
      const userId = await (0, _settingService.getSetting)('last_authenticated_user_id');
      if (userId) set({
        lastAuthenticatedUserId: userId
      });
    } catch (err) {
      _logger.default.warn('[app-state-store] hydrateFromDb failed', {
        error: String(err)
      });
    }
  }
}));

// Selector hooks for optimized subscriptions
const useIsNavigationReady = () => useAppStateStore(state => state.isNavigationReady);
exports.useIsNavigationReady = useIsNavigationReady;
const useIsAppInitialized = () => useAppStateStore(state => state.isAppInitialized);
exports.useIsAppInitialized = useIsAppInitialized;
const useLastAuthenticatedUserId = () => useAppStateStore(state => state.lastAuthenticatedUserId);
exports.useLastAuthenticatedUserId = useLastAuthenticatedUserId;