"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useForYouPrefsStore = void 0;
var _zustand = require("zustand");
var _logger = _interopRequireDefault(require("../logger"));
var _settingService = require("../database/services/setting-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const SETTING_KEY = 'for_you_recent_24h_only';
const useForYouPrefsStore = exports.useForYouPrefsStore = (0, _zustand.create)()(set => ({
  recent24hOnly: false,
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await (0, _settingService.getSetting)(SETTING_KEY);
      set({
        recent24hOnly: raw === '1',
        hydrated: true
      });
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          store: 'for-you-prefs-store'
        }
      });
      set({
        hydrated: true
      });
    }
  },
  setRecent24hOnly: value => {
    set({
      recent24hOnly: value
    });
    (0, _settingService.setSetting)(SETTING_KEY, value ? '1' : '0').catch(err => _logger.default.captureException(err, {
      tags: {
        store: 'for-you-prefs-store'
      }
    }));
  }
}));