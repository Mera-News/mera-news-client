"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useOnboardingStore = exports.useOnboardingStep = exports.useOnboardingPreferences = exports.useOnboardingIsInitializing = exports.useOnboardingCompletedSteps = void 0;
var _zustand = require("zustand");
var _settingService = require("../database/services/setting-service");
var _graphqlTypes = require("../generated/graphql-types");
var _logger = _interopRequireDefault(require("../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const initialPreferences = {
  userId: '',
  countries: [],
  newsImpact: '',
  notificationHours: [],
  processingMode: _graphqlTypes.ProcessingMode.Cloud
};
const initialState = {
  currentStep: 0,
  isInitializing: true,
  preferences: initialPreferences,
  completedSteps: []
};
const ONBOARDING_KEY = 'onboarding_state';

// Only `preferences` is persisted now — `currentStep` is derived from the
// server's `onboardingStage` on wizard mount (see OnboardingWizard), and
// `completedSteps` was never used outside the persistence layer.
function persistOnboardingState(state) {
  (0, _settingService.setSetting)(ONBOARDING_KEY, JSON.stringify(state)).catch(() => {});
}
const useOnboardingStore = exports.useOnboardingStore = (0, _zustand.create)()((set, get) => ({
  ...initialState,
  setStep: step => {
    set({
      currentStep: step
    });
  },
  nextStep: () => {
    set(state => ({
      currentStep: Math.min(state.currentStep + 1, 1)
    }));
  },
  prevStep: () => {
    set(state => ({
      currentStep: Math.max(state.currentStep - 1, 0)
    }));
  },
  setIsInitializing: value => set({
    isInitializing: value
  }),
  updatePreferences: (key, value) => {
    set(state => ({
      preferences: {
        ...state.preferences,
        [key]: value
      }
    }));
    const s = get();
    persistOnboardingState({
      preferences: s.preferences
    });
  },
  markStepCompleted: step => {
    set(state => ({
      completedSteps: state.completedSteps.includes(step) ? state.completedSteps : [...state.completedSteps, step]
    }));
  },
  resetOnboarding: () => {
    set(initialState);
    (0, _settingService.deleteSetting)(ONBOARDING_KEY).catch(() => {});
  },
  hydrateFromDb: async () => {
    try {
      const raw = await (0, _settingService.getSetting)(ONBOARDING_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      set({
        preferences: state.preferences ?? initialPreferences
      });
    } catch (err) {
      _logger.default.warn('[onboarding-store] hydrateFromDb failed', {
        error: String(err)
      });
    }
  }
}));

// Selector hooks for optimized subscriptions
const useOnboardingStep = () => useOnboardingStore(state => state.currentStep);
exports.useOnboardingStep = useOnboardingStep;
const useOnboardingPreferences = () => useOnboardingStore(state => state.preferences);
exports.useOnboardingPreferences = useOnboardingPreferences;
const useOnboardingIsInitializing = () => useOnboardingStore(state => state.isInitializing);
exports.useOnboardingIsInitializing = useOnboardingIsInitializing;
const useOnboardingCompletedSteps = () => useOnboardingStore(state => state.completedSteps);
exports.useOnboardingCompletedSteps = useOnboardingCompletedSteps;