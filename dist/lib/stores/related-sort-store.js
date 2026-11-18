"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RELATED_SORT_MODES = exports.DEFAULT_RELATED_SORT_MODE = void 0;
exports.parseRelatedSortMode = parseRelatedSortMode;
exports.useRelatedSortStore = void 0;
var _zustand = require("zustand");
var _settingService = require("../database/services/setting-service");
var _logger = _interopRequireDefault(require("../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const KEY = 'related_articles_sort';

/** Menu order for the Related Articles sort control. */
const RELATED_SORT_MODES = exports.RELATED_SORT_MODES = ['relevance', 'oldest', 'newest'];

/** Today's ordering — country blocks, then language/publication/date. */
const DEFAULT_RELATED_SORT_MODE = exports.DEFAULT_RELATED_SORT_MODE = 'relevance';

/** Narrows an untrusted stored value; anything unrecognised falls back. */
function parseRelatedSortMode(raw, fallback = DEFAULT_RELATED_SORT_MODE) {
  return RELATED_SORT_MODES.includes(raw) ? raw : fallback;
}
// Optimistic set + background persist, same as importance-filter-store: the
// list re-sorts off the set() alone, so the menu feels instant.
function persist(mode) {
  (0, _settingService.setSetting)(KEY, mode).catch(err => _logger.default.captureException(err, {
    tags: {
      store: 'related-sort-store'
    }
  }));
}
const useRelatedSortStore = exports.useRelatedSortStore = (0, _zustand.create)()(set => ({
  mode: DEFAULT_RELATED_SORT_MODE,
  hydrated: false,
  reset: () => set({
    mode: DEFAULT_RELATED_SORT_MODE,
    hydrated: false
  }),
  hydrate: async () => {
    try {
      const raw = await (0, _settingService.getSetting)(KEY);
      set({
        mode: parseRelatedSortMode(raw),
        hydrated: true
      });
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          store: 'related-sort-store'
        }
      });
      set({
        hydrated: true
      });
    }
  },
  setMode: mode => {
    set({
      mode
    });
    persist(mode);
  }
}));