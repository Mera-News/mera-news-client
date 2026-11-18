"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useWebSearchInChat = exports.useSkipNotes = exports.useSelectedModelId = exports.useProcessingMode = exports.useProcessProgress = exports.useModelState = exports.useMeraProtocolStore = exports.useIsProcessing = exports.useIsOnDeviceProcessing = exports.useIsModelReady = exports.useDownloadProgress = exports.useChatInCloud = exports.SETTING_SKIP_NOTES = exports.SETTING_CHAT_IN_CLOUD = void 0;
var _settingService = require("../database/services/setting-service");
var _graphqlTypes = require("../generated/graphql-types");
var _logger = _interopRequireDefault(require("../logger"));
var _modelCatalog = require("../mera-protocol-toolkit/core/model-catalog");
var _zustand = require("zustand");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const DEFAULT_SELECTED_MODEL_ID = _modelCatalog.DEFAULT_MODEL_ID;
const DEFAULT_PROCESSING_MODE = _graphqlTypes.ProcessingMode.Cloud;
const SETTING_PROCESSING_MODE = 'mera_processing_mode';
const SETTING_INJECT_NOISE = 'mera_inject_noise';
const SETTING_WEB_SEARCH_IN_CHAT = 'mera_web_search_in_chat';
/** Absent means off. Carried by backup: it is a preference the reader set. */
const SETTING_SKIP_NOTES = exports.SETTING_SKIP_NOTES = 'mera_skip_notes';
/** Absent means off. Carried by backup, like skip notes. */
const SETTING_CHAT_IN_CLOUD = exports.SETTING_CHAT_IN_CLOUD = 'mera_chat_in_cloud';
// RETIRED. Fact checking is part of the product now rather than an opt-in, so
// this key is no longer READ — only swept, so a device that once stored 'false'
// does not keep a row implying a preference the app no longer honours.
//
// Sweeping rather than migrating is the decision, not an oversight: an explicit
// 'false' is deliberately NOT carried forward anywhere, because the switch it
// belonged to no longer exists. Anyone who had turned fact checks off now gets
// them, which is what "part of the product" means.
const RETIRED_SETTING_FACT_CHECK = 'mera_fact_check';
/**
 * One-shot marker for the web-search default flip.
 *
 * Web search used to be opt-in and OFF, and the flip to on-by-default was a
 * deliberate product decision to reach EVERY device, not just fresh installs —
 * so the first hydrate after the update DELETES whatever
 * `mera_web_search_in_chat` held, including an explicit 'false', and writes
 * this marker. Same shape as the retired fact-check sweep above and for the
 * same reason: a stored preference for a default that no longer exists is not
 * a preference anyone expressed about the current app.
 *
 * It is a marker and NOT a retirement: the toggle is still on the Mera Protocol
 * screen, so an opt-out made AFTER the flip is honoured forever. Only the one
 * pre-flip value is discarded, and only once.
 */
const SETTING_WEB_SEARCH_FORCED_ON = 'mera_web_search_forced_on_v1';
const LEGACY_SETTING_PROTOCOL_ENABLED = 'mera_protocol_enabled';
/** Retired with the legacy questionnaire-level persona flow. Never read — kept
 *  only so `reset()` clears the orphaned row from devices that persisted it. */
const RETIRED_SETTING_LEGACY_PERSONA_UPDATE = 'mera_legacy_persona_update';
/** Retired with the relevance-v2 math-authoritative toggle. Never read; kept
 *  only so `reset()`/`hydrateFromDb` clear the orphaned row from devices that
 *  persisted it. */
const RETIRED_SETTING_RELEVANCE_V2 = 'mera_relevance_v2';
const initialState = {
  processingMode: DEFAULT_PROCESSING_MODE,
  injectNoise: false,
  // ON by default since web search shipped. Its twin — the marker branch in
  // `hydrateFromDb` — must agree, or the hydrate overwrites this on every
  // existing device and the feature ships dark.
  webSearchInChat: true,
  skipNotes: false,
  chatInCloud: false,
  selectedModelId: DEFAULT_SELECTED_MODEL_ID,
  modelState: 'not_downloaded',
  downloadProgress: 0,
  modelError: null,
  isProcessing: false,
  processProgress: 0,
  processedCount: 0,
  totalCount: 0
};
const useMeraProtocolStore = exports.useMeraProtocolStore = (0, _zustand.create)(set => ({
  ...initialState,
  setProcessingMode: processingMode => {
    set({
      processingMode
    });
    (0, _settingService.setSetting)(SETTING_PROCESSING_MODE, processingMode).catch(() => {});
  },
  setInjectNoise: injectNoise => {
    set({
      injectNoise
    });
    (0, _settingService.setSetting)(SETTING_INJECT_NOISE, injectNoise ? 'true' : 'false').catch(() => {});
  },
  setWebSearchInChat: webSearchInChat => {
    set({
      webSearchInChat
    });
    (0, _settingService.setSetting)(SETTING_WEB_SEARCH_IN_CHAT, webSearchInChat ? 'true' : 'false').catch(() => {});
  },
  setSkipNotes: skipNotes => {
    set({
      skipNotes
    });
    (0, _settingService.setSetting)(SETTING_SKIP_NOTES, skipNotes ? 'true' : 'false').catch(() => {});
  },
  setChatInCloud: chatInCloud => {
    set({
      chatInCloud
    });
    (0, _settingService.setSetting)(SETTING_CHAT_IN_CLOUD, chatInCloud ? 'true' : 'false').catch(() => {});
  },
  setSelectedModelId: selectedModelId => {
    set({
      selectedModelId
    });
    (0, _settingService.setSetting)('mera_selected_model_id', selectedModelId).catch(() => {});
  },
  setModelState: modelState => set({
    modelState,
    modelError: null
  }),
  setDownloadProgress: downloadProgress => set({
    downloadProgress
  }),
  setModelError: modelError => set({
    modelError,
    modelState: 'error'
  }),
  startProcessing: totalCount => set({
    isProcessing: true,
    processProgress: 0,
    processedCount: 0,
    totalCount
  }),
  updateProgress: processedCount => set(state => ({
    processedCount,
    processProgress: state.totalCount > 0 ? processedCount / state.totalCount : 0
  })),
  finishProcessing: () => set(state => ({
    isProcessing: false,
    processProgress: 1,
    processedCount: state.totalCount
  })),
  reset: () => {
    set(initialState);
    (0, _settingService.deleteSetting)(SETTING_PROCESSING_MODE).catch(() => {});
    (0, _settingService.deleteSetting)(LEGACY_SETTING_PROTOCOL_ENABLED).catch(() => {});
    (0, _settingService.deleteSetting)('mera_selected_model_id').catch(() => {});
    (0, _settingService.deleteSetting)(SETTING_INJECT_NOISE).catch(() => {});
    (0, _settingService.deleteSetting)(SETTING_WEB_SEARCH_IN_CHAT).catch(() => {});
    (0, _settingService.deleteSetting)(SETTING_SKIP_NOTES).catch(() => {});
    (0, _settingService.deleteSetting)(SETTING_CHAT_IN_CLOUD).catch(() => {});
    // The marker goes too. A reset device is a fresh device, and a fresh device
    // gets the current default — leaving the marker behind would make the next
    // hydrate honour an absent row as "on" anyway, but leaving it AND a stale
    // value behind is how a reset silently preserves a preference it just
    // deleted.
    (0, _settingService.deleteSetting)(SETTING_WEB_SEARCH_FORCED_ON).catch(() => {});
    (0, _settingService.deleteSetting)(RETIRED_SETTING_FACT_CHECK).catch(() => {});
    (0, _settingService.deleteSetting)(RETIRED_SETTING_RELEVANCE_V2).catch(() => {});
    (0, _settingService.deleteSetting)(RETIRED_SETTING_LEGACY_PERSONA_UPDATE).catch(() => {});
    (0, _settingService.deleteSetting)('e2ee_enabled').catch(() => {});
  },
  hydrateFromDb: async () => {
    try {
      const [modeValue, legacyEnabledValue, modelIdValue, injectNoiseValue, webSearchValue, webSearchForcedOnValue, skipNotesValue, chatInCloudValue] = await Promise.all([(0, _settingService.getSetting)(SETTING_PROCESSING_MODE), (0, _settingService.getSetting)(LEGACY_SETTING_PROTOCOL_ENABLED), (0, _settingService.getSetting)('mera_selected_model_id'), (0, _settingService.getSetting)(SETTING_INJECT_NOISE), (0, _settingService.getSetting)(SETTING_WEB_SEARCH_IN_CHAT), (0, _settingService.getSetting)(SETTING_WEB_SEARCH_FORCED_ON), (0, _settingService.getSetting)(SETTING_SKIP_NOTES), (0, _settingService.getSetting)(SETTING_CHAT_IN_CLOUD)]);
      // One-shot cleanup: the retired v2 key is never read, just swept so it
      // doesn't linger.
      (0, _settingService.deleteSetting)(RETIRED_SETTING_RELEVANCE_V2).catch(() => {});
      (0, _settingService.deleteSetting)(RETIRED_SETTING_FACT_CHECK).catch(() => {});
      const updates = {};
      if (modeValue === _graphqlTypes.ProcessingMode.OnDevice || modeValue === _graphqlTypes.ProcessingMode.Cloud) {
        updates.processingMode = modeValue;
      } else if (legacyEnabledValue !== null) {
        // One-shot migration from the pre-enum boolean setting.
        const migrated = legacyEnabledValue === 'true' ? _graphqlTypes.ProcessingMode.OnDevice : _graphqlTypes.ProcessingMode.Cloud;
        updates.processingMode = migrated;
        (0, _settingService.setSetting)(SETTING_PROCESSING_MODE, migrated).catch(() => {});
        (0, _settingService.deleteSetting)(LEGACY_SETTING_PROTOCOL_ENABLED).catch(() => {});
      }
      if (modelIdValue !== null) {
        if ((0, _modelCatalog.isRetiredModelId)(modelIdValue)) {
          // A retired model is no longer offered. Remap it to the default and
          // rewrite the row, so a restored old backup cannot bring it back.
          // Its files are deleted at boot by retireLegacyModels().
          updates.selectedModelId = DEFAULT_SELECTED_MODEL_ID;
          (0, _settingService.setSetting)('mera_selected_model_id', DEFAULT_SELECTED_MODEL_ID).catch(() => {});
        } else {
          updates.selectedModelId = modelIdValue;
        }
      }
      if (injectNoiseValue === 'true') {
        updates.injectNoise = true;
      } else if (injectNoiseValue === 'false') {
        updates.injectNoise = false;
      }
      // WEB SEARCH: ABSENT ⇒ ON, and a one-shot sweep of whatever came before.
      //
      // This is the exact inverse of the rule that used to live here, and the
      // reversal is the decision, not a slip. The old comment read "a device
      // that has never seen the toggle must not inherit an on state from a
      // missing row"; web search is now part of the product rather than an
      // opt-in, so an absent row means the default, and the default is on.
      //
      // The marker makes the sweep happen ONCE. Before it exists, any stored
      // value — including an explicit 'false' set while the feature was opt-in
      // — is deleted and the setting comes up on. After it exists, an explicit
      // 'false' is honoured forever, because that one was chosen against the
      // current default by a user looking at the current switch.
      if (webSearchForcedOnValue !== 'true') {
        updates.webSearchInChat = true;
        (0, _settingService.deleteSetting)(SETTING_WEB_SEARCH_IN_CHAT).catch(() => {});
        (0, _settingService.setSetting)(SETTING_WEB_SEARCH_FORCED_ON, 'true').catch(() => {});
      } else {
        updates.webSearchInChat = webSearchValue !== 'false';
      }
      updates.skipNotes = skipNotesValue === 'true';
      updates.chatInCloud = chatInCloudValue === 'true';
      if (Object.keys(updates).length > 0) {
        set(updates);
      }
    } catch (err) {
      _logger.default.warn('[mera-protocol-store] hydrateFromDb failed', {
        error: String(err)
      });
    }
  }
}));

// Selector hooks
const useProcessingMode = () => useMeraProtocolStore(state => state.processingMode);
exports.useProcessingMode = useProcessingMode;
const useIsOnDeviceProcessing = () => useMeraProtocolStore(state => state.processingMode === _graphqlTypes.ProcessingMode.OnDevice);
exports.useIsOnDeviceProcessing = useIsOnDeviceProcessing;
const useWebSearchInChat = () => useMeraProtocolStore(state => state.webSearchInChat);
exports.useWebSearchInChat = useWebSearchInChat;
const useSkipNotes = () => useMeraProtocolStore(state => state.skipNotes);
exports.useSkipNotes = useSkipNotes;
const useChatInCloud = () => useMeraProtocolStore(state => state.chatInCloud);
exports.useChatInCloud = useChatInCloud;
const useSelectedModelId = () => useMeraProtocolStore(state => state.selectedModelId);
exports.useSelectedModelId = useSelectedModelId;
const useModelState = () => useMeraProtocolStore(state => state.modelState);
exports.useModelState = useModelState;
const useDownloadProgress = () => useMeraProtocolStore(state => state.downloadProgress);
exports.useDownloadProgress = useDownloadProgress;
const useIsModelReady = () => useMeraProtocolStore(state => state.modelState === 'ready');
exports.useIsModelReady = useIsModelReady;
const useIsProcessing = () => useMeraProtocolStore(state => state.isProcessing);
exports.useIsProcessing = useIsProcessing;
const useProcessProgress = () => useMeraProtocolStore(state => ({
  progress: state.processProgress,
  processed: state.processedCount,
  total: state.totalCount
}));
exports.useProcessProgress = useProcessProgress;