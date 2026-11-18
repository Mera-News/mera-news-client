"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.__clearPublisherSourceNames = exports.PUBLISHER_SOURCE_NAMES_SETTING = exports.PUBLISHER_SOURCE_NAMES_MAX = void 0;
exports.fetchPublicationPrefNames = fetchPublicationPrefNames;
exports.groupPrefRowsByPublication = groupPrefRowsByPublication;
exports.hydratePublisherSourceNames = hydratePublisherSourceNames;
exports.knownSourceNamesForName = knownSourceNamesForName;
exports.knownSourceNamesForPublisher = knownSourceNamesForPublisher;
exports.persistPublisherSourceNames = persistPublisherSourceNames;
exports.rememberPublisherSourceNames = rememberPublisherSourceNames;
exports.resetPublisherSourceNames = resetPublisherSourceNames;
exports.resolvePublicationPrefNames = resolvePublicationPrefNames;
var _publicationPrefLevel = require("../../algorithms/publication-pref-level");
// publisher-source-names: which source names belong to which publisher, as far
// as THIS device knows. The more/fewer control writes one preference row per
// name (see publication-pref-level.ts), so an entry point that knows only one
// name (a card, "Fewer from") needs the rest from somewhere without a network
// round trip.
//
// Two local sources, in order:
//  1. Memory, filled by every response that lists a publisher's full source
//     set: the publication profile (`sourceNames`) and the Sources publisher
//     list (`newsPublishers.publicationSources`). NOT `searchPublishers`: its
//     `matchingSources` is the filtered subset that matched the query.
//  2. The subscriptions table, whose `source_names_json` holds a subscribed
//     publisher's full source set (normalized).
//
// A name that belongs to more than one known publisher is AMBIGUOUS and never
// expands: the caller writes the name it was given and nothing else. Writing
// another publisher's names would change that publisher's news.
//
// Persisted to ONE settings row (`publisher_source_names_cache`), so grouping
// and offline lists work on a cold start: loaded by `hydratePublisherSourceNames`
// from hydrateAllStores, saved (debounced) after that on every change. It is
// public catalogue data and holds nothing about the reader beyond which
// publishers were loaded; the settings backup is an allowlist, so the row is
// never backed up. A logout or account switch clears the row with the
// database and the memory with `resetPublisherSourceNames` (clearAllStores).
// Capped,
// least recently recorded publisher dropped first.
//
// Nothing here touches the database at import time: the settings service and
// the subscriptions service are required lazily, so a module that only
// records names (source-service, the profile service) stays DB-free, and
// nothing is SAVED until hydration has run (a test that records names never
// reaches the database).

/** The settings row the map persists to. */
const PUBLISHER_SOURCE_NAMES_SETTING = exports.PUBLISHER_SOURCE_NAMES_SETTING = 'publisher_source_names_cache';
/** Publishers kept; the least recently recorded go first. */
const PUBLISHER_SOURCE_NAMES_MAX = exports.PUBLISHER_SOURCE_NAMES_MAX = 1500;
const SAVE_DEBOUNCE_MS = 1000;

/** Insertion order is recency: a record moves its publisher to the end. */
const namesByPublisher = new Map();
const publishersByName = new Map();
let persistEnabled = false;
let dirty = false;
let saveTimer = null;
function indexPublisher(publisherId, names) {
  for (const n of names) {
    const key = (0, _publicationPrefLevel.normalizePrefName)(n);
    let owners = publishersByName.get(key);
    if (!owners) {
      owners = new Set();
      publishersByName.set(key, owners);
    }
    owners.add(publisherId);
  }
}
function unindexPublisher(publisherId) {
  const previous = namesByPublisher.get(publisherId);
  if (!previous) return;
  for (const n of previous) {
    const key = (0, _publicationPrefLevel.normalizePrefName)(n);
    const owners = publishersByName.get(key);
    owners?.delete(publisherId);
    if (owners && owners.size === 0) publishersByName.delete(key);
  }
}
function enforceCap() {
  while (namesByPublisher.size > PUBLISHER_SOURCE_NAMES_MAX) {
    const oldest = namesByPublisher.keys().next().value;
    unindexPublisher(oldest);
    namesByPublisher.delete(oldest);
  }
}
function schedulePersist() {
  dirty = true;
  if (!persistEnabled || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistPublisherSourceNames();
  }, SAVE_DEBOUNCE_MS);
}

/** Write the map to its settings row now. A lost write costs one refetch. */
async function persistPublisherSourceNames() {
  if (!persistEnabled || !dirty) return;
  dirty = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      setSetting
    } = require("./setting-service");
    await setSetting(PUBLISHER_SOURCE_NAMES_SETTING, JSON.stringify({
      v: 1,
      publishers: Array.from(namesByPublisher.entries())
    }));
  } catch {
    dirty = true;
  }
}
function parseCache(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v !== 1 || !Array.isArray(parsed.publishers)) return [];
    const out = [];
    for (const entry of parsed.publishers) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue;
      const names = (0, _publicationPrefLevel.publisherPrefNames)(entry[1]);
      if (entry[0] && names.length > 0) out.push([entry[0], names]);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Load the persisted map (called once from hydrateAllStores) and start
 * saving. Anything recorded in memory before the load is newer and wins.
 * Never rejects.
 */
async function hydratePublisherSourceNames() {
  let loaded = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      getSetting
    } = require("./setting-service");
    loaded = parseCache(await getSetting(PUBLISHER_SOURCE_NAMES_SETTING));
  } catch {
    loaded = [];
  }
  const newer = Array.from(namesByPublisher.entries());
  namesByPublisher.clear();
  publishersByName.clear();
  for (const [id, names] of [...loaded.filter(([id]) => !newer.some(([n]) => n === id)), ...newer]) {
    namesByPublisher.set(id, names);
    indexPublisher(id, names);
  }
  enforceCap();
  persistEnabled = true;
  if (dirty) schedulePersist();
}

/** Record a publisher's FULL source-name set (replacing what was known). */
function rememberPublisherSourceNames(publisherId, names) {
  if (!publisherId) return;
  const next = (0, _publicationPrefLevel.publisherPrefNames)(names);
  const previous = namesByPublisher.get(publisherId);
  const unchanged = !!previous && previous.length === next.length && previous.every((n, i) => n === next[i]);
  unindexPublisher(publisherId);
  namesByPublisher.delete(publisherId);
  if (next.length > 0) {
    namesByPublisher.set(publisherId, next); // to the end: most recent
    indexPublisher(publisherId, next);
    enforceCap();
  }
  if (!unchanged) schedulePersist();
}

/** The recorded source names of a publisher, or null when none are known. */
function knownSourceNamesForPublisher(publisherId) {
  return namesByPublisher.get(publisherId) ?? null;
}

/**
 * The other names of the ONE publisher that owns `name`, from memory.
 * Null when no publisher is known for it, or when more than one is.
 */
function knownSourceNamesForName(name) {
  const owners = publishersByName.get((0, _publicationPrefLevel.normalizePrefName)(name));
  if (!owners || owners.size !== 1) return null;
  const [publisherId] = Array.from(owners);
  return namesByPublisher.get(publisherId) ?? null;
}

/** What an entry point knows about the publication whose preference it sets. */

/**
 * Every name to read and write a publication's more/fewer under, using only
 * what is on the device: the caller's hints, memory, then subscriptions.
 * Never touches the network. Always includes the hints themselves, so an
 * unknown publication still gets its raw name.
 */
async function resolvePublicationPrefNames(hints) {
  const fromMemory = (hints.publisherId ? knownSourceNamesForPublisher(hints.publisherId) : null) ?? (hints.rawName ? knownSourceNamesForName(hints.rawName) : null) ?? (hints.publisherName ? knownSourceNamesForName(hints.publisherName) : null);
  const names = (0, _publicationPrefLevel.publisherPrefNames)(hints.sourceNames ?? [], fromMemory ?? [], hints.publisherName, hints.rawName);
  if (hints.sourceNames?.length || fromMemory) return names;

  // Nothing in memory: a subscribed publisher still knows its sources.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const subs = require("./user-publication-subscription-service");
    const active = await subs.getActive();
    const keys = new Set(names.map(_publicationPrefLevel.normalizePrefName));
    const matches = active.filter(s => hints.publisherId && s.publisherId === hints.publisherId || keys.has((0, _publicationPrefLevel.normalizePrefName)(s.publisherName ?? '')) || subs.parseSourceNames(s.sourceNamesJson).some(n => keys.has((0, _publicationPrefLevel.normalizePrefName)(n))));
    // Ambiguous across publishers: keep the caller's names only.
    if (new Set(matches.map(s => s.publisherId)).size !== 1) return names;
    const sub = matches[0];
    return (0, _publicationPrefLevel.publisherPrefNames)(names, sub.publisherName, subs.parseSourceNames(sub.sourceNamesJson));
  } catch {
    return names;
  }
}

/**
 * The full name set for a search hit, fetched when this device does not know
 * it yet, and recorded. A row control calls this before it writes: the hit's
 * `matchingSources` is the subset that matched the query, never the set.
 *
 * Throws when the set cannot be had, so the caller refuses the write: a
 * preference under part of a publication's names reaches part of its news.
 * `fetchPublisherSourceNames` answers [] for a failed query.
 */
async function fetchPublicationPrefNames(hints) {
  if (!hints.sourceNames?.length && !knownSourceNamesForPublisher(hints.publisherId)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      fetchPublisherSourceNames
    } = require("../../subscriptions/publisher-sources");
    const fetched = await fetchPublisherSourceNames(hints.publisherId);
    if (fetched.length === 0) throw new Error('publisher source names unavailable');
    rememberPublisherSourceNames(hints.publisherId, fetched);
  }
  return resolvePublicationPrefNames(hints);
}

/** One publication's preference rows, as the Source preferences screen lists them. */

/**
 * Group preference rows so ONE publication is ONE entry, however many source
 * names it was written under. Pure and synchronous (reads the in-memory map,
 * which hydrateAllStores has loaded from its settings row).
 *
 * - Named rows whose name belongs to exactly one known publisher group under
 *   that publisher; `names` is the rows' names plus every known source name,
 *   so a change from the screen reaches all of them.
 * - A name with no known publisher, or with two, groups only with rows of the
 *   same normalized name.
 * - A country-scope row is always its own group, with `names: []`.
 *
 * Groups keep the order their first row appears in.
 */
function groupPrefRowsByPublication(rows) {
  const groups = new Map();
  rows.forEach((row, index) => {
    if (row.scopeKind != null) {
      groups.set(`scope:${index}`, {
        key: `scope:${index}`,
        publisherId: null,
        names: [],
        rows: [row]
      });
      return;
    }
    const norm = (0, _publicationPrefLevel.normalizePrefName)(row.publicationName ?? '');
    const owners = publishersByName.get(norm);
    const publisherId = owners && owners.size === 1 ? Array.from(owners)[0] : null;
    const key = publisherId ? `publisher:${publisherId}` : `name:${norm}`;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      group.names = (0, _publicationPrefLevel.publisherPrefNames)(group.names, row.publicationName);
      return;
    }
    groups.set(key, {
      key,
      publisherId,
      names: (0, _publicationPrefLevel.publisherPrefNames)(row.publicationName, publisherId ? namesByPublisher.get(publisherId) ?? [] : []),
      rows: [row]
    });
  });
  return Array.from(groups.values());
}

/**
 * Forget everything and stop saving until the next hydrate. Called by
 * `clearAllStores` (logout and account switch): the settings row goes with the
 * database reset, but this memory would outlive it, and the next record would
 * write the previous account's publishers (in effect, the publication pages
 * it opened) into the new account's row.
 */
function resetPublisherSourceNames() {
  namesByPublisher.clear();
  publishersByName.clear();
  persistEnabled = false;
  dirty = false;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}

/** Test seam. */
const __clearPublisherSourceNames = exports.__clearPublisherSourceNames = resetPublisherSourceNames;