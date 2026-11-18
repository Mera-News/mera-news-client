"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DisplayPublicationName = DisplayPublicationName;
exports.PublicationDisplayUnsupportedError = exports.PUBLICATION_DISPLAY_REFRESH_MS = exports.PUBLICATION_DISPLAY_DEBOUNCE_MS = exports.PUBLICATION_DISPLAY_BATCH_MAX = void 0;
exports.createPublicationDisplayStore = createPublicationDisplayStore;
exports.displayPublicationName = displayPublicationName;
exports.makeUseDisplayPublication = makeUseDisplayPublication;
exports.usePublicationDisplayStore = exports.useDisplayPublication = void 0;
var _react = require("react");
var _zustand = require("zustand");
// publication-display-store: how to SHOW a publication's name in the app
// language. 人民日报 reads "Renmin Ribao" to an English reader and
// Le Monde reads "Ле Монд" to a Russian one: written phonetically in the
// reader's script, never translated for meaning (the server computes it).
//
// DISPLAY ONLY. The raw `publication_name` stays the KEY everywhere: "Fewer
// from", publication prefs, visit rows, hard filters and the scorer all write
// and match the raw name. Only display sites read this store, through
// `useDisplayPublication` (or `displayPublicationName` in a callback).
//
// Shape:
//  - `names` is raw name -> display name for the CURRENT app language. A name
//    the server had no entry for is stored as itself, so it counts as known and
//    is never asked for again (that is what stops a flicker loop).
//  - Names are collected as cards render them and sent in one debounced,
//    batched call, at most PUBLICATION_DISPLAY_BATCH_MAX per call.
//  - The map is cached per language by the `load`/`save` ports (the settings
//    table), so it shows instantly on launch and survives being offline. A
//    cache older than PUBLICATION_DISPLAY_REFRESH_MS is shown, and each name
//    is refreshed the next time it is DISPLAYED, never eagerly at launch:
//    before sign-in there is no session, and an UNAUTHENTICATED answer feeds
//    the auth-failure breaker. That refresh is how a name the server
//    translated later reaches the app.
//  - A language switch drops the map, loads that language's cache and
//    refetches every name seen this session in the new language.
//
// The ports are injected (`configure`) by lib/publication-display-service.ts
// at startup. This module imports no database or network code on purpose: the
// card graph imports it, and a database import there crashes the card suites
// in jest (initializeJSI). Unwired, it queues names and does nothing else.

/** One language's cached map, as the cache port stores it. */

/** What the store needs from the outside world. */

/**
 * The server does not have the query at all (GRAPHQL_VALIDATION_FAILED: an app
 * ahead of its server). It will not grow it mid-session, so the store stops
 * asking until the next launch and every name stays raw. The fetch port
 * rejects with this; any other rejection is an ordinary, retried failure.
 */
class PublicationDisplayUnsupportedError extends Error {
  constructor() {
    super('publicationDisplayNames is not supported by this server');
    this.unsupported = true;
    this.name = 'PublicationDisplayUnsupportedError';
  }
}
exports.PublicationDisplayUnsupportedError = PublicationDisplayUnsupportedError;
function isUnsupported(err) {
  return !!err && typeof err === 'object' && err.unsupported === true;
}

/** Names per call; the server caps a call at 200. */
const PUBLICATION_DISPLAY_BATCH_MAX = exports.PUBLICATION_DISPLAY_BATCH_MAX = 200;
/** Coalesce window: a screen of cards mounting at once is one call. */
const PUBLICATION_DISPLAY_DEBOUNCE_MS = exports.PUBLICATION_DISPLAY_DEBOUNCE_MS = 250;
/** A cache older than this is refreshed in the background. */
const PUBLICATION_DISPLAY_REFRESH_MS = exports.PUBLICATION_DISPLAY_REFRESH_MS = 24 * 60 * 60 * 1000;
/** Retry after a failed call: doubles from here up to the max. */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;
/** The cache keeps the most recent entries only. */
const MAX_CACHED_NAMES = 3000;
function capNames(names) {
  const keys = Object.keys(names);
  if (keys.length <= MAX_CACHED_NAMES) return names;
  const out = {};
  for (const k of keys.slice(keys.length - MAX_CACHED_NAMES)) out[k] = names[k];
  return out;
}

/** A fresh store. The app uses the one instance below; tests make their own. */
function createPublicationDisplayStore() {
  let ports = null;
  /** Every name asked for this session, in any language. */
  const seen = new Set();
  /** Names waiting for the next call, in the current language. */
  let pending = new Set();
  /** Cached names older than the refresh window, refreshed when next shown. */
  let stale = new Set();
  let timer = null;
  let inFlight = false;
  let failures = 0;
  /** Set for the rest of the session by a PublicationDisplayUnsupportedError. */
  let unsupported = false;
  const store = (0, _zustand.create)((set, get) => {
    const schedule = (delay = PUBLICATION_DISPLAY_DEBOUNCE_MS) => {
      if (unsupported || !ports || get().language === null || timer || inFlight || pending.size === 0) return;
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, delay);
    };
    const flush = async () => {
      const language = get().language;
      if (!ports || language === null || pending.size === 0) return;
      const batch = Array.from(pending).slice(0, PUBLICATION_DISPLAY_BATCH_MAX);
      for (const n of batch) pending.delete(n);
      const activePorts = ports;
      inFlight = true;
      let answer;
      try {
        const raw = await activePorts.fetch(language, batch);
        // No data (or not a map) means "no display names": keep the raw ones.
        answer = raw && typeof raw === 'object' ? raw : {};
      } catch (err) {
        inFlight = false;
        if (isUnsupported(err)) {
          // Never again this session: raw names, no calls, no logs.
          unsupported = true;
          pending.clear();
          return;
        }
        // A switch mid-call already rebuilt `pending` for the new language.
        if (get().language !== language) {
          schedule();
          return;
        }
        for (const n of batch) pending.add(n);
        failures += 1;
        schedule(Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS));
        return;
      }
      inFlight = false;
      if (get().language !== language) {
        // Answered in the language the user just left: never show or cache it.
        schedule();
        return;
      }
      failures = 0;
      const names = {
        ...get().names
      };
      for (const n of batch) names[n] = typeof answer[n] === 'string' && answer[n] ? answer[n] : n;
      set({
        names
      });
      activePorts.save(language, {
        savedAt: Date.now(),
        names: capNames(names)
      }).catch(() => undefined);
      schedule();
    };
    return {
      language: null,
      names: {},
      request: name => {
        if (unsupported || typeof name !== 'string' || !name || pending.has(name)) return;
        if (get().names[name] !== undefined) {
          if (!stale.has(name)) return;
          stale.delete(name);
        } else if (seen.has(name) && get().language !== null) {
          // In flight, or failed and waiting on its backoff retry.
          return;
        }
        seen.add(name);
        pending.add(name);
        schedule();
      },
      setLanguage: async language => {
        if (get().language === language) return;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        failures = 0;
        set({
          language,
          names: {}
        });
        let cached = null;
        try {
          cached = ports ? await ports.load(language) : null;
        } catch {
          cached = null;
        }
        // Switched again while the cache loaded: that call owns the store now.
        if (get().language !== language) return;
        const names = cached?.names ?? {};
        const expired = cached ? Date.now() - cached.savedAt > PUBLICATION_DISPLAY_REFRESH_MS : false;
        // Names already shown this session are fetched now (the session is
        // live); every other expired entry waits until it is displayed.
        pending = new Set(Array.from(seen).filter(n => names[n] === undefined || expired));
        stale = expired ? new Set(Object.keys(names).filter(n => !pending.has(n))) : new Set();
        set({
          names
        });
        schedule();
      },
      configure: next => {
        ports = next;
        if (!next && timer) {
          clearTimeout(timer);
          timer = null;
        }
      }
    };
  });
  return store;
}
const usePublicationDisplayStore = exports.usePublicationDisplayStore = createPublicationDisplayStore();

/**
 * The hook factory, so tests can bind it to their own store.
 *
 * The store parameter MUST be named `use…`. The app is built with the React
 * Compiler, which memoises any call whose callee is not named like a hook: a
 * binding named `store` made `store(selector)` run only when `name` changed,
 * so zustand's hooks were skipped on the next render and the card crashed
 * with a hook-order change. `publication-display-store.compiled.test.ts`
 * renders this module compiled, and fails if that comes back.
 */
function makeUseDisplayPublication(useStore) {
  function useDisplay(name) {
    const key = typeof name === 'string' ? name : '';
    const display = useStore(s => key ? s.names[key] : undefined);
    // On every name (a stale cached one is refreshed once); `request` is
    // idempotent, so a settled name costs nothing and cannot loop.
    (0, _react.useEffect)(() => {
      if (key) useStore.getState().request(key);
    }, [key, display]);
    return display ?? name;
  }
  return useDisplay;
}

/**
 * A publication name as the reader should SEE it: the display form in the app
 * language when known, otherwise the name itself. Display sites only; never
 * pass the result to a write, a filter or a match (those keep the raw name).
 */
const useDisplayPublication = exports.useDisplayPublication = makeUseDisplayPublication(usePublicationDisplayStore);

/** {@link useDisplayPublication} for a callback (a toast, a dialog body). */
function displayPublicationName(name) {
  if (!name) return name;
  return usePublicationDisplayStore.getState().names[name] ?? name;
}

/**
 * `name` rendered in its display form, for a list row where a hook cannot sit
 * inside `.map`. Nest it inside a <Text>: it renders a bare string.
 */
function DisplayPublicationName({
  name
}) {
  // A bare string return, not createElement: the NativeWind babel transform
  // rewrites a createElement import even in a .ts file, and a suite that
  // mocks react-native-css-interop then throws on it.
  return useDisplayPublication(name);
}