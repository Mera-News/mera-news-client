"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useBlurImagesStore = void 0;
var _zustand = require("zustand");
var _logger = _interopRequireDefault(require("../logger"));
var _settingService = require("../database/services/setting-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const SETTING_KEY = 'blur_images';
const useBlurImagesStore = exports.useBlurImagesStore = (0, _zustand.create)()(set => ({
  blurImages: false,
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await (0, _settingService.getSetting)(SETTING_KEY);
      set({
        blurImages: raw === '1',
        hydrated: true
      });
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          store: 'blur-images-store'
        }
      });
      set({
        hydrated: true
      });
    }
  },
  setBlurImages: value => {
    set({
      blurImages: value
    });
    (0, _settingService.setSetting)(SETTING_KEY, value ? '1' : '0').catch(err => _logger.default.captureException(err, {
      tags: {
        store: 'blur-images-store'
      }
    }));
  }
}));