"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TRANSLATION_CACHE_TTL_DAYS = exports.TRANSLATION_CACHE_HYDRATE_LIMIT = exports.TRANSLATION_CACHE_FLUSH_MAX_BUFFER = exports.TRANSLATION_CACHE_FLUSH_DEBOUNCE_MS = void 0;
exports.__resetTranslationCacheBufferForTests = __resetTranslationCacheBufferForTests;
exports.__translationCacheBufferSizeForTests = __translationCacheBufferSizeForTests;
exports.flushTranslationCacheWrites = flushTranslationCacheWrites;
exports.hashSourceText = hashSourceText;
exports.loadTranslationCache = loadTranslationCache;
exports.rememberTranslation = rememberTranslation;
exports.sweepTranslationCache = sweepTranslationCache;
exports.translationCacheId = translationCacheId;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
var _fnv1a = require("../../algorithms/fnv1a");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Persistence for the on-device translation cache.
//
// WHAT CHANGED AND WHY. The cache used to be an in-memory `Map` in
// `lib/stores/app-language-store` and nothing else: no persistence, no table.
// Every translation the OS produced was thrown away on app exit, and a language
// switch replaced the Map wholesale — so switching back to a language you had
// used all week re-translated every headline from scratch, one serial native
// call at a time. That, not the queue, is most of what "translation is slow"
// felt like on a warm app.
//
// Three properties this file exists to guarantee:
//
//  1. WRITES ARE BATCHED. A fast scroll completes dozens of translations in a
//     couple of seconds. One `database.write` each would be dozens of SQLite
//     transactions competing with feed sync and scoring. Completions land in a
//     buffer and flush on a trailing debounce, as ONE batch.
//
//  2. READS ARE A SINGLE QUERY. Hydration pulls the most recently used rows for
//     ONE language and hands back a plain Map. `TranslatableDynamic` reads that
//     Map synchronously during render, so anything not hydrated by the time a
//     node renders still costs a native call — hydration therefore runs early
//     (see `hydrate-stores`) and again on every language switch.
//
//  3. IT IS BOUNDED. Every title × every language ever seen is not a cache, it
//     is a leak. One TTL sweep per hydrate, plus a cap on how much is held in
//     memory.

/** Rows untouched for this long are swept on the next hydrate. */
const TRANSLATION_CACHE_TTL_DAYS = exports.TRANSLATION_CACHE_TTL_DAYS = 30;

/**
 * Most-recently-used rows loaded into memory per language.
 *
 * Kept modest on purpose. `hydrateFromDb` AWAITS this load (the render path
 * reads the Map synchronously, so a node that renders ahead of the hydrate
 * still pays a native call) and that await sits inside the `Promise.all` whose
 * completion flips `database-store.ready` — the gate for `syncFeed`. Every row
 * here is a materialized WatermelonDB model in front of that gate. The query is
 * MRU-ordered and a screenful is ~20 titles, so the head of the list is what
 * earns the win; the tail mostly buys latency.
 */
const TRANSLATION_CACHE_HYDRATE_LIMIT = exports.TRANSLATION_CACHE_HYDRATE_LIMIT = 1500;

/** Trailing coalesce window for buffered writes. */
const TRANSLATION_CACHE_FLUSH_DEBOUNCE_MS = exports.TRANSLATION_CACHE_FLUSH_DEBOUNCE_MS = 1500;

/** Hard cap on the write buffer — flush immediately once it is this full. */
const TRANSLATION_CACHE_FLUSH_MAX_BUFFER = exports.TRANSLATION_CACHE_FLUSH_MAX_BUFFER = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * FNV-1a (32-bit) over the source text, hex, with the length appended in base
 * 36.
 *
 * Deliberately NOT a cryptographic hash: this is a cache key, there is no
 * adversary, and `expo-crypto`'s digest is async (which would put an await
 * between a completed translation and the buffer that records it). Length is
 * mixed in because FNV-1a's weakest case is short strings differing only in
 * trailing characters — headlines. And a collision is harmless anyway: the full
 * `source_text` is stored and compared on read, so the worst case is a miss.
 */
function hashSourceText(text) {
  return `${(0, _fnv1a.fnv1a32)(text).toString(16)}${text.length.toString(36)}`;
}

/** The WatermelonDB row id for one (text, language) pair — the primary key. */
function translationCacheId(text, targetLang) {
  return `${hashSourceText(text)}:${targetLang}`;
}
/** id → pending write. A Map so a re-translation of the same key coalesces. */
const writeBuffer = new Map();
let flushTimer = null;
let flushInFlight = null;

/**
 * Record one completed translation. Buffered — returns immediately, never
 * throws, and never blocks the render path that produced it.
 */
function rememberTranslation(sourceText, targetLang, translatedText) {
  if (!sourceText || !targetLang || !translatedText) return;
  writeBuffer.set(translationCacheId(sourceText, targetLang), {
    sourceText,
    targetLang,
    translatedText
  });
  if (writeBuffer.size >= TRANSLATION_CACHE_FLUSH_MAX_BUFFER) {
    void flushTranslationCacheWrites();
    return;
  }
  // NON-resetting trailing debounce: a re-arming timer would never fire
  // during a continuous scroll, which is exactly when the buffer fills.
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushTranslationCacheWrites();
  }, TRANSLATION_CACHE_FLUSH_DEBOUNCE_MS);
}

/**
 * Write everything buffered so far, as ONE batch. Safe to call at any time
 * (app background, tests); resolves when the batch has landed.
 */
function flushTranslationCacheWrites() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  // Serialize: a second flush while one is in flight would re-read the buffer
  // the first one is draining.
  if (flushInFlight) {
    return flushInFlight.then(() => writeBuffer.size > 0 ? flushTranslationCacheWrites() : undefined);
  }
  if (writeBuffer.size === 0) return Promise.resolve();
  const entries = [...writeBuffer.entries()];
  writeBuffer.clear();
  flushInFlight = (async () => {
    const collection = _index.default.get('translation_cache');
    const ids = entries.map(([id]) => id);
    // ONE query for the whole batch — never one `find()` per row.
    const existing = await collection.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(ids))).fetch();
    const byId = new Map(existing.map(row => [row.id, row]));
    const now = new Date();
    const ops = entries.map(([id, item]) => {
      const found = byId.get(id);
      if (found) {
        return found.prepareUpdate(row => {
          // A different source under the same id is a hash collision:
          // the row takes over the newcomer whole, never a mix.
          if (row.sourceText !== item.sourceText) {
            row.sourceHash = hashSourceText(item.sourceText);
            row.sourceText = item.sourceText;
          }
          row.translatedText = item.translatedText;
          row.lastUsedAt = now;
        });
      }
      return collection.prepareCreate(row => {
        // The row id IS `${hash}:${lang}` — that is what makes the read
        // path a primary-key hit. Same `_raw.id` seeding the feed uses.
        const raw = row._raw;
        if (raw) raw.id = id;
        row.sourceHash = hashSourceText(item.sourceText);
        row.targetLang = item.targetLang;
        row.sourceText = item.sourceText;
        row.translatedText = item.translatedText;
        row.createdAt = now;
        row.lastUsedAt = now;
      });
    });
    await _index.default.write(async () => {
      await _index.default.batch(...ops);
    });
    _logger.default.debug('[TranslationCache] Persisted translations', {
      count: ops.length
    });
  })().catch(err => {
    // A cache write failing is never worth surfacing — the translation
    // is already on screen and the next visit just re-asks the OS.
    _logger.default.warn('[TranslationCache] Failed to persist translations', {
      count: entries.length,
      error: err instanceof Error ? err.message : String(err)
    });
  }).then(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

/**
 * Every cached translation for one language, most-recently-used first, as the
 * `sourceText → translatedText` Map the store holds.
 *
 * Returns an empty Map on any error: a missing cache is a slow app, a throwing
 * hydrate is a broken one.
 */
async function loadTranslationCache(targetLang, limit = TRANSLATION_CACHE_HYDRATE_LIMIT) {
  const out = new Map();
  if (!targetLang || targetLang === 'en') return out;
  try {
    const rows = await _index.default.get('translation_cache').query(_watermelondb.Q.where('target_lang', targetLang), _watermelondb.Q.sortBy('last_used_at', _watermelondb.Q.desc), _watermelondb.Q.take(limit)).fetch();
    for (const row of rows) {
      if (row.sourceText && row.translatedText) out.set(row.sourceText, row.translatedText);
    }
    _logger.default.debug('[TranslationCache] Hydrated', {
      targetLang,
      count: out.size
    });
  } catch (err) {
    _logger.default.warn('[TranslationCache] Failed to hydrate', {
      targetLang,
      error: err instanceof Error ? err.message : String(err)
    });
  }
  return out;
}

/**
 * Delete rows untouched for {@link TRANSLATION_CACHE_TTL_DAYS}. Returns how
 * many were removed. Never throws.
 */
async function sweepTranslationCache(ttlDays = TRANSLATION_CACHE_TTL_DAYS, now = Date.now()) {
  const cutoff = now - ttlDays * DAY_MS;
  try {
    const collection = _index.default.get('translation_cache');
    const stale = await collection.query(_watermelondb.Q.where('last_used_at', _watermelondb.Q.lt(cutoff))).fetch();
    if (stale.length === 0) return 0;
    await _index.default.write(async () => {
      await _index.default.batch(...stale.map(row => row.prepareDestroyPermanently()));
    });
    _logger.default.debug('[TranslationCache] Swept stale rows', {
      count: stale.length
    });
    return stale.length;
  } catch (err) {
    _logger.default.warn('[TranslationCache] Sweep failed', {
      error: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }
}

/** Test seam — drops anything buffered without writing it. */
function __resetTranslationCacheBufferForTests() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  writeBuffer.clear();
  flushInFlight = null;
}

/** Test seam — how many writes are buffered right now. */
function __translationCacheBufferSizeForTests() {
  return writeBuffer.size;
}