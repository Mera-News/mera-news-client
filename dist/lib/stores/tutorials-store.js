"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TUTORIAL_SETTING_PREFIX = void 0;
exports.chapterCompletedKey = chapterCompletedKey;
exports.chapterIdFromKey = chapterIdFromKey;
exports.useTutorialsStore = void 0;
var _zustand = require("zustand");
var _settingService = require("../database/services/setting-service");
var _logger = _interopRequireDefault(require("../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Tutorial completion state, over the settings KV.
//
// One row per completed chapter (`tutorial_chapter_<slug>_completed`) plus one
// flag for "has opened the menu at least once". Absence is the default — an
// unwritten row means not-completed — so there is nothing to migrate and
// nothing to backfill, and `lib/database/schema.ts` is untouched.
//
// Hydration is ONE `getSettingsByPrefix('tutorial_')` query rather than N
// `getSetting` calls: the caller cannot enumerate which chapters were completed
// up front, so the rows that exist ARE the answer.

/** Shared prefix for every row this store owns — the hydrate query's argument. */
const TUTORIAL_SETTING_PREFIX = exports.TUTORIAL_SETTING_PREFIX = 'tutorial_';
const MENU_SEEN_KEY = `${TUTORIAL_SETTING_PREFIX}menu_seen`;

/** `tutorial_chapter_<slug>_completed`. Exported for the test and for sweeps. */
function chapterCompletedKey(chapterId) {
  return `${TUTORIAL_SETTING_PREFIX}chapter_${chapterId}_completed`;
}

/** Inverse of {@link chapterCompletedKey}; `null` for any other row. */
function chapterIdFromKey(key) {
  const prefix = `${TUTORIAL_SETTING_PREFIX}chapter_`;
  const suffix = '_completed';
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null;
  const id = key.slice(prefix.length, key.length - suffix.length);
  return id.length > 0 ? id : null;
}
const initialState = {
  completed: new Set(),
  menuSeen: false,
  hydrated: false
};

// Optimistic set + background persist, same shape as the other settings-KV
// stores: the menu re-renders off the set() alone, so a tick appears the instant
// a chapter ends regardless of DB latency.
function persist(key, value) {
  (0, _settingService.setSetting)(key, value).catch(err => _logger.default.captureException(err, {
    tags: {
      store: 'tutorials-store'
    }
  }));
}
const useTutorialsStore = exports.useTutorialsStore = (0, _zustand.create)()((set, get) => ({
  ...initialState,
  reset: () => set({
    ...initialState,
    completed: new Set()
  }),
  hydrate: async () => {
    try {
      const rows = await (0, _settingService.getSettingsByPrefix)(TUTORIAL_SETTING_PREFIX);
      const completed = new Set();
      for (const [key, value] of Object.entries(rows)) {
        if (value !== 'true') continue;
        const chapterId = chapterIdFromKey(key);
        if (chapterId) completed.add(chapterId);
      }
      set({
        completed,
        menuSeen: rows[MENU_SEEN_KEY] === 'true',
        hydrated: true
      });
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          store: 'tutorials-store'
        }
      });
      // Still flip `hydrated`: a failed read must not leave the menu spinning
      // forever. Worst case the user sees zero ticks and re-watches a chapter.
      set({
        hydrated: true
      });
    }
  },
  markCompleted: chapterId => {
    if (get().completed.has(chapterId)) return;
    const next = new Set(get().completed);
    next.add(chapterId);
    set({
      completed: next
    });
    persist(chapterCompletedKey(chapterId), 'true');
  },
  markMenuSeen: () => {
    if (get().menuSeen) return;
    set({
      menuSeen: true
    });
    persist(MENU_SEEN_KEY, 'true');
  }
}));