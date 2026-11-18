"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.phoneLanguage = phoneLanguage;
exports.useAppLanguageStore = exports.useAppLanguage = exports.translationCacheKey = void 0;
var _zustand = require("zustand");
var _localization = require("../platform/localization");
var _settingService = require("../database/services/setting-service");
var _translationCacheService = require("../database/services/translation-cache-service");
var _translation = require("../platform/translation");
var _supportedLanguages = require("../supported-languages");
var _i18n = require("../platform/i18n");
const APP_LANGUAGE_KEY = 'app_language';

/** The cache key for a source text: the persisted columns trim, so the in-memory key must too. */
const translationCacheKey = text => text.trim();
exports.translationCacheKey = translationCacheKey;
const SUPPORTED_CODES = new Set(_supportedLanguages.SUPPORTED_LANGUAGES.map(l => l.code));

// Legacy app_language values → iOS translation codes
const LEGACY_CODE_MAP = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'pt-BR': 'pt'
};
function normalizeCode(raw) {
  if (!raw) return null;
  const mapped = LEGACY_CODE_MAP[raw] ?? raw;
  if (SUPPORTED_CODES.has(mapped)) return mapped;
  const prefix = mapped.split('-')[0];
  if (SUPPORTED_CODES.has(prefix)) return prefix;
  return null;
}

/** The phone's own language, as an app language code (the first-launch list
 *  marks it "Your phone's language"). */
function phoneLanguage() {
  const locales = (0, _localization.getLocales)();
  const tag = locales[0]?.languageTag ?? 'en';
  return normalizeCode(tag) ?? 'en';
}

/**
 * The default before anyone picks: the phone's language when this phone can
 * translate into it, else English. Defaulting to a language
 * the phone cannot translate made the startup probe block it and put the
 * "unavailable" notice on the very first screen. Lazy require: the
 * translation service imports this store.
 */
function resolveDeviceLocale() {
  const code = phoneLanguage();
  if (code === 'en') return code;
  const {
    canTranslateIntoLanguage
  } = require("../platform/translation");
  return canTranslateIntoLanguage(code) ? code : 'en';
}
const useAppLanguageStore = exports.useAppLanguageStore = (0, _zustand.create)((set, get) => ({
  appLanguage: 'en',
  cache: new Map(),
  pending: new Set(),
  cacheVersion: 0,
  setAppLanguage: async lang => {
    const normalized = normalizeCode(lang) ?? 'en';
    // Full invalidation: replace the Map/Set references (a language switch
    // means every cached translation is now stale).
    set({
      appLanguage: normalized,
      cache: new Map(),
      pending: new Set()
    });
    // Retire every native call queued for the language being left. They
    // cannot be cancelled once dispatched (the completion handler in
    // TranslatableDynamic discards those), but the queued ones are pure
    // waste and they sit in front of the re-translation of the screen the
    // user is looking at. The availability probe is epoch-exempt, so the
    // one call that verifies the NEW language is untouched.
    (0, _translation.bumpTranslationEpoch)(`language:${normalized}`);
    // …then refill from disk for the language being ADOPTED. This is what
    // makes switching back to a language you have used before instant
    // instead of a full re-translation of every headline on screen, one
    // serial native call at a time. Fire-and-forget: the UI language change
    // must not wait on SQLite, and an empty cache is merely slow.
    void get().hydrateTranslationCache(normalized).catch(() => {
      // never block a language change on the cache
    });
    // Picking a language is a deliberate user action — give the new one a
    // clean slate. Scoped to the language being ADOPTED, not the whole
    // map: the language being left keeps its breaker state, so a failed
    // switch that reverts here lands the user back exactly where they
    // were, rather than silently re-arming a language already known to be
    // broken.
    (0, _translation.clearTranslationFailuresFor)(normalized);
    (0, _i18n.applyLanguage)(normalized);
    await (0, _settingService.setSetting)(APP_LANGUAGE_KEY, normalized);

    // One-way sync: push the picked UI language into the persona's
    // language_codes as the primary code (preserving any others). Dynamic
    // require avoids a static store→services import cycle; fire-and-forget
    // + internal error-swallowing so the sync never blocks the UI change.
    try {
      const {
        syncAppLanguageToPersona
      } = require("../language-sync");
      void syncAppLanguageToPersona(normalized);
    } catch {
      // never block the local UI language change on the sync path
    }
  },
  cacheTranslation: (original, translated) => {
    // Mutate the existing Map/Set in place — no new references — then bump
    // cacheVersion so zustand notifies. Exactly one bump per call.
    const {
      cache,
      pending,
      appLanguage
    } = get();
    const key = translationCacheKey(original);
    cache.set(key, translated);
    pending.delete(original);
    set({
      cacheVersion: get().cacheVersion + 1
    });
    // Persist. Buffered + debounced inside the service, so a fast scroll
    // that completes dozens of translations still costs ONE SQLite
    // transaction. This is the single funnel every completed translation
    // passes through, which is why it is the only place that writes.
    try {
      (0, _translationCacheService.rememberTranslation)(key, appLanguage, translated);
    } catch {
      // a cache write must never break the render path that produced it
    }
  },
  addPending: text => {
    get().pending.add(text);
    set({
      cacheVersion: get().cacheVersion + 1
    });
  },
  removePending: text => {
    get().pending.delete(text);
    set({
      cacheVersion: get().cacheVersion + 1
    });
  },
  // Full invalidation: replace the Map/Set references.
  clearCache: () => set({
    cache: new Map(),
    pending: new Set()
  }),
  hydrateTranslationCache: async lang => {
    const target = lang ?? get().appLanguage;
    if (!target || target === 'en') return;
    const loaded = await (0, _translationCacheService.loadTranslationCache)(target);
    if (loaded.size === 0) return;
    // Only apply if the user has not switched languages underneath us —
    // otherwise a slow load for the language they just left would repopulate
    // the cache with translations into the wrong language, and every keyed
    // read would silently hit them.
    if (get().appLanguage !== target) return;
    // Replace the reference (a bulk load is a full invalidation, not an
    // append), and carry over anything translated while the load was in
    // flight — those are newer than what came off disk.
    const merged = new Map(loaded);
    for (const [key, value] of get().cache) merged.set(key, value);
    set({
      cache: merged,
      cacheVersion: get().cacheVersion + 1
    });
  },
  hydrateFromDb: async () => {
    const stored = await (0, _settingService.getSetting)(APP_LANGUAGE_KEY);
    const normalized = normalizeCode(stored) ?? resolveDeviceLocale();
    set({
      appLanguage: normalized
    });
    // Persist normalized value back if we migrated a legacy code
    if (stored && stored !== normalized) {
      await (0, _settingService.setSetting)(APP_LANGUAGE_KEY, normalized);
    }

    // Load the persisted translations for this language BEFORE returning.
    // TranslatableDynamic reads the cache synchronously during render, so a
    // node that renders ahead of the hydrate still fires a native call —
    // awaiting here is what turns the second launch into zero native calls.
    // It is one indexed query and it does not gate first paint (the feed
    // hydrate runs ahead of every other store).
    await get().hydrateTranslationCache(normalized);

    // Bounded, once per launch, after the useful work: every headline ×
    // every language ever seen is a leak, not a cache. Fire-and-forget.
    void (0, _translationCacheService.sweepTranslationCache)().catch(() => {
      // sweeping is best-effort housekeeping
    });

    // NO native call here. Re-verifying the saved language is deliberately
    // NOT done during boot hydration — see the once-per-launch probe in
    // components/custom/TranslationUnavailablePrompt.tsx, which waits for
    // the app to be mounted and idle first, because that call can present
    // Apple's system sheet.
  }
}));

// A translation that outlived its timeout still lands in the cache, unless the reader switched language since.
(0, _translation.setLateTranslationSink)((text, target, translated) => {
  if (useAppLanguageStore.getState().appLanguage === target) useAppLanguageStore.getState().cacheTranslation(text, translated);
});
const useAppLanguage = () => useAppLanguageStore(s => s.appLanguage);
exports.useAppLanguage = useAppLanguage;