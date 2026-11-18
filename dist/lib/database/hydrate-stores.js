"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.hydrateAllStores = hydrateAllStores;
var _publicationVisitService = require("./services/publication-visit-service");
var _databaseStore = require("../stores/database-store");
var _languageSync = require("../language-sync");
var _logger = _interopRequireDefault(require("../logger"));
var _host = require("../platform/host");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Hydrates all Zustand stores from WatermelonDB on app startup.
//
// Fire-and-forget. The For You suggestion query goes first so it absorbs the
// WatermelonDB open + migration cost rather than queueing behind 5 unrelated
// stores — the For You screen subscribes to the store and re-renders the
// instant the suggestions set() lands. Everything else hydrates in parallel
// in the background; database-store.ready flips once all of it has settled,
// which is the gate for syncFeed.

function hydrateAllStores() {
  // Dynamic imports to avoid circular dependencies
  const {
    useForYouStore
  } = require("../stores/for-you-store");
  const {
    useUserStore
  } = require("../stores/user-store");
  const {
    useMeraProtocolStore
  } = require("../stores/mera-protocol-store");
  const {
    useOnboardingStore
  } = require("../stores/onboarding-store");
  const {
    useAppLanguageStore
  } = require("../stores/app-language-store");
  const {
    useAppStateStore
  } = require("../stores/app-state-store");
  const {
    useForYouPrefsStore
  } = require("../stores/for-you-prefs-store");
  const {
    useBlurImagesStore
  } = require("../stores/blur-images-store");
  const {
    useRelatedSortStore
  } = require("../stores/related-sort-store");
  const {
    useTutorialsStore
  } = require("../stores/tutorials-store");

  // Paint-critical: load cached article_suggestions and push them to the
  // store first. No metadata, no expired-cleanup, no other-store gating.
  // Not awaited (first-paint design). Never rejects: the store catches inside.
  void useForYouStore.getState().hydrateSuggestionsFromDb();

  // Everything else, in parallel, in the background. Returned promise
  // resolves once full hydration + backfill is done — callers who need
  // hydrated state (e.g. processingMode, userPersona) can chain on this,
  // but no caller should block first paint on it.
  return Promise.allSettled([useForYouStore.getState().hydrateMetadataFromDb(), useUserStore.getState().hydrateFromDb(), useMeraProtocolStore.getState().hydrateFromDb(), useOnboardingStore.getState().hydrateFromDb(),
  // Publication display names follow the app language: wired the moment it
  // is known (not after the whole hydrate), so the cached map is on screen
  // with the first cards, and even when an unrelated hydration fails.
  useAppLanguageStore.getState().hydrateFromDb().finally(() => {
    void require("../publication-display-service").installPublicationDisplayNames();
  }), useAppStateStore.getState().hydrateFromDb(),
  // Not a Zustand store: the publisher -> source-names map behind more/fewer
  // grouping and the publication page's offline list. Loaded before
  // database-store.ready so the Source preferences screen groups on a cold
  // start. Never rejects.
  require("./services/publisher-source-names").hydratePublisherSourceNames(), useForYouPrefsStore.getState().hydrate(), useBlurImagesStore.getState().hydrate(), useRelatedSortStore.getState().hydrate(), useTutorialsStore.getState().hydrate(),
  // The host's own state (its interface preferences, page orders, backup
  // settings). Inside this allSettled so `ready` still flips after it.
  (0, _host.hydrateHostState)(),
  // Not a Zustand store: the gateway's daily reading hold (a settings row
  // mirrored in memory), loaded before any scoring path can ask
  // `isReadHeld()`. Never rejects.
  require("../subscription/read-hold").hydrateReadHold()]).then(results => {
    // One entry rejecting must not skip the rest of the chain or flip `ready`
    // early: every entry has settled by here, and each failure is reported.
    for (const result of results) {
      if (result.status === 'rejected') {
        _logger.default.captureException(result.reason, {
          tags: {
            module: 'hydrate-stores',
            step: 'hydrate-entry'
          }
        });
      }
    }

    // Fire-and-forget: back-fill the persona's primary language_codes from the
    // (now-hydrated) app UI language for users who picked a language before the
    // sync existed. Deliberately NOT awaited — it must never gate
    // database-store.ready or first-paint.
    (0, _languageSync.reconcileAppLanguageWithPersona)().catch(err => {
      _logger.default.captureException(err, {
        tags: {
          module: 'hydrate-stores',
          step: 'reconcile-app-language'
        }
      });
    });
    return (0, _publicationVisitService.pruneStaleVisits)();
  }).finally(() => _databaseStore.useDatabaseStore.getState().setReady(true)).then(() => undefined);
}