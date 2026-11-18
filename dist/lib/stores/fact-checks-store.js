"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CHECKS_SEEN_AT_SETTING_KEY = void 0;
exports.isFactCheckDone = isFactCheckDone;
exports.isUnseenDone = isUnseenDone;
exports.useFactChecksStore = exports.useFactChecksRefreshing = exports.useFactChecksHydrated = exports.useFactCheckItems = exports.useChecksUnseen = void 0;
exports.watchFactChecks = watchFactChecks;
var _zustand = require("zustand");
var _factCheckRecordService = require("../database/services/fact-check-record-service");
var _savedArticleSuggestionService = require("../database/services/saved-article-suggestion-service");
// In-memory mirror of the on-device `fact_checks` table.
//
// Why a store at all rather than each surface querying WatermelonDB: three
// unrelated places write to that table — a chat-driven check being enqueued,
// the fact-check runner landing a result, and the list screen's delete — and two places
// read it. Without a shared subscription, deleting a row on the list screen
// leaves the Dashboard's block showing it until the Dashboard happens to
// remount, and a result that lands while the Dashboard is elsewhere never
// appears until the next explicit read.
//
// Deliberately NOT a WatermelonDB observable: the table is tiny (one row per
// claim the user personally asked about), the surfaces are two, and an
// explicit `load()` on each (re)selection is three lines against a
// subscription lifecycle to manage. Revisit if a third reader appears.
//
// The Library's Fact checks dot (FinalLibrary #5) is the third reader:
// `watchFactChecks` re-reads on every change to the table, so a check that
// finishes while the reader is elsewhere lights the dot. `seenAt` is the one
// settings row the dot needs (`library_checks_seen_at`, device-local,
// forbidden from backup): operational state, not a counter. Read with the
// items in `load`, so it lives and dies with them.
//
// `refresh` used to also RECONCILE every unresolved row against the server —
// that pipeline is gone. There is nothing left to reconcile against: the
// on-device runner writes straight to this table (via `fact-check-queue.ts`),
// so a local read is already the up-to-date answer. `refresh` is kept as a
// distinct action (rather than folded into `load`) only so the list's
// `RefreshControl` has something with its own in-flight flag to bind to.

/** Lazy: a module-scope import of the settings service or the database
 *  singleton opens SQLite at import, in every suite that loads this store. */
function settings() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../database/services/setting-service");
}
const CHECKS_SEEN_AT_SETTING_KEY = exports.CHECKS_SEEN_AT_SETTING_KEY = 'library_checks_seen_at';

/** The stored statuses a check never leaves (fact-check-record-service). */
const TERMINAL_STATUSES = new Set(['complete', 'blocked']);
function isFactCheckDone(item) {
  return TERMINAL_STATUSES.has(String(item.status ?? '').trim().toLowerCase());
}

/** A finished check the reader has not seen since it finished. */
function isUnseenDone(item, seenAt) {
  return seenAt !== null && isFactCheckDone(item) && (item.resolvedAt ?? 0) > seenAt;
}
async function readSeenAt() {
  const raw = await settings().getSetting(CHECKS_SEEN_AT_SETTING_KEY).catch(() => null);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) return n;
  // First read on this phone: today is the baseline, so years-old checks
  // never light the dot.
  const now = Date.now();
  void settings().setSetting(CHECKS_SEEN_AT_SETTING_KEY, String(now)).catch(() => undefined);
  return now;
}
const useFactChecksStore = exports.useFactChecksStore = (0, _zustand.create)((set, get) => ({
  items: [],
  hydrated: false,
  refreshing: false,
  seenAt: null,
  load: async () => {
    const [items, seenAt] = await Promise.all([(0, _factCheckRecordService.listFactChecks)(), readSeenAt()]);
    set({
      items,
      hydrated: true,
      seenAt
    });
  },
  markSeen: () => {
    const now = Date.now();
    set({
      seenAt: now
    });
    void settings().setSetting(CHECKS_SEEN_AT_SETTING_KEY, String(now)).catch(() => undefined);
  },
  refresh: async () => {
    if (get().refreshing) return;
    set({
      refreshing: true
    });
    try {
      const items = await (0, _factCheckRecordService.listFactChecks)();
      set({
        items,
        hydrated: true
      });
    } finally {
      set({
        refreshing: false
      });
    }
  },
  remove: async id => {
    // Captured before the optimistic filter drops it — the retention
    // release below needs the article id.
    const item = get().items.find(it => it.id === id);
    // Optimistic: the delete is local-only and the service swallows its own
    // failures, so waiting would only make the row linger under the finger.
    set(state => ({
      items: state.items.filter(it => it.id !== id)
    }));
    await (0, _factCheckRecordService.deleteFactCheck)(id);
    // Deleting the LAST fact check for an article releases its retention
    // snapshot (the release checks that itself, and never touches a row the
    // user saved). Hooked here rather than in the record service so the two
    // DB services stay import-cycle free.
    if (item?.articleId) {
      await (0, _savedArticleSuggestionService.releaseFactCheckRetention)(item.articleId);
    }
  }
}));

/**
 * The whole list, newest first. Consumers slice it themselves inside a `useMemo`
 * — a `.slice()` INSIDE the selector would allocate a fresh array on every store
 * read, and zustand compares with `Object.is`, so it would re-render forever.
 */
const useFactCheckItems = () => useFactChecksStore(state => state.items);
exports.useFactCheckItems = useFactCheckItems;
const useFactChecksHydrated = () => useFactChecksStore(state => state.hydrated);
exports.useFactChecksHydrated = useFactChecksHydrated;
const useFactChecksRefreshing = () => useFactChecksStore(state => state.refreshing);

/** Some finished check is unseen: the Fact checks pill dot and the Library
 *  tab dot. */
exports.useFactChecksRefreshing = useFactChecksRefreshing;
const useChecksUnseen = () => useFactChecksStore(state => state.items.some(it => isUnseenDone(it, state.seenAt)));

/** Re-read on every change to the fact_checks table. Started once by the
 *  Library tab (mounted for the app's life); returns its stop. */
exports.useChecksUnseen = useChecksUnseen;
function watchFactChecks() {
  void useFactChecksStore.getState().load();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const database = require("../database").default;
  const sub = database.withChangesForTables(['fact_checks']).subscribe(() => {
    void useFactChecksStore.getState().load();
  });
  return () => sub.unsubscribe();
}