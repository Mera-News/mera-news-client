"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fetchPublicationDisplayNames = fetchPublicationDisplayNames;
exports.installPublicationDisplayNames = installPublicationDisplayNames;
exports.publicationDisplayCacheKey = publicationDisplayCacheKey;
exports.publicationDisplayPorts = void 0;
exports.serverLocaleFor = serverLocaleFor;
var _client = require("@apollo/client");
var _apolloClient = _interopRequireDefault(require("./platform/apollo-client"));
var _logger = _interopRequireDefault(require("./logger"));
var _settingService = require("./database/services/setting-service");
var _appLanguageStore = require("./stores/app-language-store");
var _publicationDisplayStore = require("./stores/publication-display-store");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// publication-display-service: the network and cache side of the publication
// display-name store (lib/stores/publication-display-store.ts).
//
// - fetch: the `publicationDisplayNames(language, names)` query. The server
//   returns `publication_name_i18n[language]`, falling back to the name.
// - cache: one JSON row per app language in the settings table. No new table,
//   no migration, no article column.
// - install: wires both into the store and makes it follow the app language.
//   Called once from hydrateAllStores, after the app language has hydrated.
//
// The store never imports this file (the card graph must stay free of Apollo
// and the database), so a card test never touches the network.

const PUBLICATION_DISPLAY_NAMES = (0, _client.gql)`
  query PublicationDisplayNames($language: String!, $names: [String!]!) {
    publicationDisplayNames(language: $language, names: $names) {
      name
      displayName
    }
  }
`;

/**
 * The app's language codes are the iOS ones (SUPPORTED_LANGUAGES); the server
 * keys `publication_name_i18n` by its own locale list and looks the code up
 * as given. Three are spelled differently. Unmapped, Portuguese and both
 * Chinese scripts would silently get raw names.
 */
const SERVER_LOCALE = {
  pt: 'pt-BR',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW'
};
function serverLocaleFor(appLanguage) {
  return SERVER_LOCALE[appLanguage] ?? appLanguage;
}

/** GraphQL error codes on a rejection (Apollo 4 `errors`, Apollo 3 `graphQLErrors`). */
function graphQLErrorCodes(err) {
  if (!err || typeof err !== 'object') return [];
  const list = err.errors ?? err.graphQLErrors;
  if (!Array.isArray(list)) return [];
  return list.map(e => e?.extensions?.code).filter(c => typeof c === 'string');
}
let unsupportedLogged = false;

/**
 * raw name -> display name, in the app language given. Rejects on failure;
 * with {@link PublicationDisplayUnsupportedError} when the server has no such
 * query (GRAPHQL_VALIDATION_FAILED), which the store treats as "stop asking
 * until the next launch". Logged once, at info: an app ahead of its server is
 * a deploy order, not an error.
 */
async function fetchPublicationDisplayNames(appLanguage, names) {
  const language = serverLocaleFor(appLanguage);
  const out = {};
  for (let i = 0; i < names.length; i += _publicationDisplayStore.PUBLICATION_DISPLAY_BATCH_MAX) {
    const variables = {
      language,
      names: names.slice(i, i + _publicationDisplayStore.PUBLICATION_DISPLAY_BATCH_MAX)
    };
    let data;
    try {
      ({
        data
      } = await _apolloClient.default.query({
        query: PUBLICATION_DISPLAY_NAMES,
        variables,
        // The store and its settings row are the cache; Apollo's would only be
        // a second, unbounded copy.
        fetchPolicy: 'no-cache',
        // Not part of the feed sync. A failure here (a server that has not
        // deployed the query yet) must never paint "sync failed" on the feed.
        // A server without the query answers GRAPHQL_VALIDATION_FAILED, which
        // this function handles (unsupported for the session): a breadcrumb,
        // not a Sentry event (lib/apollo-client's expectedErrorCodes).
        context: {
          noSyncStatus: true,
          expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
        }
      }));
    } catch (err) {
      if (graphQLErrorCodes(err).includes('GRAPHQL_VALIDATION_FAILED')) {
        if (!unsupportedLogged) {
          unsupportedLogged = true;
          _logger.default.info('[publication-display] server has no publicationDisplayNames; raw names this session');
        }
        throw new _publicationDisplayStore.PublicationDisplayUnsupportedError();
      }
      throw err;
    }
    for (const row of data?.publicationDisplayNames ?? []) {
      if (row?.name && row.displayName) out[row.name] = row.displayName;
    }
  }
  return out;
}
function publicationDisplayCacheKey(appLanguage) {
  return `publication_display_names:${appLanguage}`;
}
function parseCache(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.names || typeof parsed.names !== 'object' || Array.isArray(parsed.names)) {
      return null;
    }
    return {
      savedAt: parsed.savedAt,
      names: parsed.names
    };
  } catch {
    return null;
  }
}
const publicationDisplayPorts = exports.publicationDisplayPorts = {
  fetch: fetchPublicationDisplayNames,
  load: async appLanguage => parseCache(await (0, _settingService.getSetting)(publicationDisplayCacheKey(appLanguage))),
  save: async (appLanguage, entry) => {
    try {
      await (0, _settingService.setSetting)(publicationDisplayCacheKey(appLanguage), JSON.stringify(entry));
    } catch (err) {
      // A lost write only costs one refetch next launch.
      _logger.default.warn('[publication-display] cache write failed', {
        error: String(err)
      });
    }
  }
};
let unsubscribeLanguage = null;

/**
 * Wire the store: inject the ports, adopt the current app language and follow
 * every change. Safe to call again (a re-hydrate): the previous subscription
 * is replaced, never doubled.
 */
function installPublicationDisplayNames(store = _publicationDisplayStore.usePublicationDisplayStore, languages = _appLanguageStore.useAppLanguageStore) {
  store.getState().configure(publicationDisplayPorts);
  unsubscribeLanguage?.();
  unsubscribeLanguage = languages.subscribe((s, prev) => {
    if (s.appLanguage !== prev.appLanguage) void store.getState().setLanguage(s.appLanguage);
  });
  return store.getState().setLanguage(languages.getState().appLanguage);
}