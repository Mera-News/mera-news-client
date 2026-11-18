"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useSectionVisitsStore = exports.SECTION_VISIT_RETENTION_MS = void 0;
var _zustand = require("zustand");
var _logger = _interopRequireDefault(require("../logger"));
var _settingService = require("../database/services/setting-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// section-visits-store — persisted map of factId → last-visited epoch ms for
// Dashboard sections. Mirrors for-you-prefs-store's persistence pattern (single
// JSON blob under one settings KV key) and opened-stories-store's optimistic-
// merge rule (a markVisited() that races ahead of hydrate() must not be lost —
// and since both sides are timestamps rather than set members, "merge" means
// keeping the newer of the two per factId, not just the union of keys).

const SETTING_KEY = 'section_last_visited_v1';
const persistVisits = visits => (0, _settingService.setSetting)(SETTING_KEY, JSON.stringify(visits)).catch(err => _logger.default.captureException(err, {
  tags: {
    store: 'section-visits-store'
  }
}));

/** Feed window is 24h; 7d is a generous retention so we don't grow unbounded
 *  across long-tail facts while still comfortably covering the feed window. */
const SECTION_VISIT_RETENTION_MS = exports.SECTION_VISIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
function parseVisits(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}
function pruneStale(visits, now) {
  const pruned = {};
  for (const [factId, atMs] of Object.entries(visits)) {
    if (now - atMs <= SECTION_VISIT_RETENTION_MS) {
      pruned[factId] = atMs;
    }
  }
  return pruned;
}
let hydrating = null;
const useSectionVisitsStore = exports.useSectionVisitsStore = (0, _zustand.create)()((set, get) => ({
  visits: {},
  hydrated: false,
  readFailed: false,
  hydrate: async () => {
    if (hydrating) return hydrating;
    hydrating = (async () => {
      try {
        const raw = await (0, _settingService.getSetting)(SETTING_KEY);
        const now = Date.now();
        const stored = pruneStale(parseVisits(raw), now);

        // Merge, don't replace — a markVisited() may have landed while the
        // settings read was in flight; that write must not be lost. For each
        // factId, the newer of the stored value and the current in-memory
        // (optimistic) value wins.
        const current = get().visits;
        const merged = {
          ...stored
        };
        for (const [factId, atMs] of Object.entries(current)) {
          if (!(factId in merged) || atMs > merged[factId]) {
            merged[factId] = atMs;
          }
        }
        const unpersisted = get().readFailed;
        set({
          visits: merged,
          hydrated: true,
          readFailed: false
        });
        // Visits made while the read was failing were never written.
        if (unpersisted) void persistVisits(merged);
      } catch (err) {
        _logger.default.captureException(err, {
          tags: {
            store: 'section-visits-store'
          }
        });
        set({
          hydrated: true,
          readFailed: true
        });
      } finally {
        hydrating = null;
      }
    })();
    return hydrating;
  },
  markVisited: (factId, atMs) => {
    const next = {
      ...get().visits,
      [factId]: atMs ?? Date.now()
    };
    set({
      visits: next
    });
    // Before the first hydrate `next` lacks the stored visits; persisting it
    // would overwrite the row. Wait for the (memoised) hydrate and write the
    // merged map instead.
    const persist = get().hydrated ? Promise.resolve(next) : get().hydrate().then(() => get().visits);
    persist.then(visits => get().readFailed ? undefined : persistVisits(visits)).catch(err => _logger.default.captureException(err, {
      tags: {
        store: 'section-visits-store'
      }
    }));
  }
}));