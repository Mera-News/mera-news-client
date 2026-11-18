// Registers a minimal host whose database is a SQLite file, for tests that run the built package in plain Node.
const path = require('node:path');

const dist = path.resolve(__dirname, '../../../dist/lib');

function memory() {
  const map = new Map();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => void map.set(key, value),
    removeItem: async (key) => void map.delete(key),
  };
}

function registerNodeHost({ dbPath }) {
  const { ApolloClient, HttpLink, InMemoryCache } = require('@apollo/client');
  const SQLiteAdapter = require('@nozbe/watermelondb/adapters/sqlite').default;
  const i18next = require('i18next');
  const { registerPlatform } = require(path.join(dist, 'platform/index'));

  const store = memory();
  const secure = memory();
  const i18n = i18next.createInstance();
  void i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } }, initAsync: false });

  registerPlatform({
    env: {
      EXPO_PUBLIC_GRAPHQL_SERVER_ENDPOINT: 'http://127.0.0.1:9',
      EXPO_PUBLIC_AUTH_ENDPOINT: 'http://127.0.0.1:9',
      EXPO_PUBLIC_INFERENCE_ENDPOINT: 'http://127.0.0.1:9',
    },
    appState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    sentry: {
      captureException: () => '',
      captureMessage: () => '',
      addBreadcrumb() {},
      setUser() {},
      setTag() {},
      setExtra() {},
      startInactiveSpan: () => ({ end() {} }),
      withScope: (callback) => callback({ setTag() {}, setLevel() {} }),
    },
    fetch: (input, init) => globalThis.fetch(input, init),
    asyncStorage: store,
    secureStore: {
      getItemAsync: secure.getItem,
      setItemAsync: secure.setItem,
      deleteItemAsync: secure.removeItem,
    },
    getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
    auth: {
      getJwtToken: async () => null,
      invalidateJwtCache() {},
      getCookie: () => null,
      recordAuthFailure() {},
    },
    // Never called: the endpoint is a closed port.
    apolloClient: new ApolloClient({ link: new HttpLink({ uri: 'http://127.0.0.1:9/graphql' }), cache: new InMemoryCache() }),
    createDatabaseAdapter: (options) => new SQLiteAdapter({ ...options, dbName: dbPath }),
    i18n,
  });
}

module.exports = { registerNodeHost, dist };
