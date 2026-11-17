// The built package loads in plain Node, with no react-native installed and no jest.
// Run through `npm run check:node` (build, then node --test).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve(__dirname, '../../dist/lib');

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : filesUnder(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

test('no phone module is installed', () => {
  assert.throws(() => require.resolve('react-native'));
  assert.throws(() => require.resolve('@sentry/react-native'));
});

test('a platform read before registration names the facade', () => {
  const { AppState } = require(path.join(dist, 'platform/react-native'));
  assert.throws(
    () => AppState.currentState,
    (error) => error.name === 'PlatformNotRegisteredError' && error.message.includes('lib/platform/react-native'),
  );
});

// The host below has no network module, as a server may not. lib/platform/netinfo then throws
// while loading by design, and its one importer (the network store) loads it inside a try.
const NETINFO = path.join(dist, 'platform/netinfo.js');

test('every built module loads once a host is registered', () => {
  const { ApolloClient, HttpLink, InMemoryCache } = require('@apollo/client');
  const LokiJSAdapter = require('@nozbe/watermelondb/adapters/lokijs').default;
  const i18next = require('i18next');
  const { registerPlatform } = require(path.join(dist, 'platform/index'));

  const memory = () => {
    const map = new Map();
    return {
      getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => void map.set(key, value),
      removeItem: async (key) => void map.delete(key),
    };
  };
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
    createDatabaseAdapter: ({ schema }) =>
      new LokiJSAdapter({ schema, useWebWorker: false, useIncrementalIndexedDB: false, extraLokiOptions: { autosave: false } }),
    i18n,
  });

  const files = filesUnder(dist);
  assert.ok(files.length > 500, `only ${files.length} built modules found`);
  for (const file of files) {
    if (file === NETINFO) continue;
    assert.doesNotThrow(() => require(file), `${path.relative(dist, file)} failed to load`);
  }
  assert.throws(() => require(NETINFO), /provides no network status/);
  console.log(`loaded ${files.length} modules`);
});
