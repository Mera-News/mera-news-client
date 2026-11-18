// node scripts/artefact-smoke.mjs <outDir>: packs the artefact, installs it into an empty directory with
// only its declared dependencies and peers (as a default npm install of it gets them), loads every
// built module once under plain Node, then writes and reads one setting on a SQLite file through the
// shipped driver. A dependency the manifest does not declare fails the run.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const outDir = process.argv[2] && resolve(process.argv[2]);
if (!outDir) throw new Error('usage: node scripts/artefact-smoke.mjs <outDir>');

const packDir = mkdtempSync(join(tmpdir(), 'artefact-pack-'));
const appDir = mkdtempSync(join(tmpdir(), 'artefact-app-'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit' });

const probe = `
const path = require('node:path');
const { ApolloClient, HttpLink, InMemoryCache } = require('@apollo/client');
const SQLiteAdapter = require('@nozbe/watermelondb/adapters/sqlite').default;
const i18next = require('i18next');
const dist = path.join(path.dirname(require.resolve('mera-news-client/package.json')), 'dist/lib');
const { registerPlatform } = require(path.join(dist, 'platform/index'));
const fs = require('node:fs');
const filesUnder = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : filesUnder(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });

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
  netInfo: { fetch: async () => ({ isConnected: true }), addEventListener: () => () => {} },
  asyncStorage: store,
  secureStore: { getItemAsync: secure.getItem, setItemAsync: secure.setItem, deleteItemAsync: secure.removeItem },
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
  auth: { getJwtToken: async () => null, invalidateJwtCache() {}, getCookie: () => null, recordAuthFailure() {} },
  apolloClient: new ApolloClient({ link: new HttpLink({ uri: 'http://127.0.0.1:9/graphql' }), cache: new InMemoryCache() }),
  createDatabaseAdapter: (options) => new SQLiteAdapter({ ...options, dbName: path.join(process.cwd(), 'smoke.db') }),
  i18n,
});

(async () => {
  const files = filesUnder(dist);
  if (files.length < 500) throw new Error('only ' + files.length + ' built modules found');
  for (const file of files) require(file);
  const database = require(path.join(dist, 'database/index.js')).default;
  await database.get('settings').query().fetch();
  const { getSetting, setSetting } = require(path.join(dist, 'database/services/setting-service.js'));
  await setSetting('probe', '1');
  const value = await getSetting('probe');
  if (value !== '1') throw new Error('expected 1, read ' + JSON.stringify(value));
  console.log('artefact smoke ok: ' + files.length + ' modules loaded');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

try {
  run('npm', ['pack', outDir, '--pack-destination', packDir, '--silent'], process.cwd());
  const tgz = join(packDir, readdirSync(packDir).find((name) => name.endsWith('.tgz')));

  mkdirSync(join(appDir, 'driver'));
  writeFileSync(join(appDir, 'driver/package.json'), JSON.stringify({ name: 'better-sqlite3', version: '0.0.0', main: 'index.js' }));
  writeFileSync(join(appDir, 'driver/index.js'), "module.exports = require('mera-news-client/node/sqlite-driver');\n");
  writeFileSync(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'smoke', version: '0.0.0', private: true, dependencies: { 'mera-news-client': `file:${tgz}`, 'better-sqlite3': 'file:./driver' } }),
  );
  writeFileSync(join(appDir, 'probe.cjs'), probe);

  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], appDir);
  run(process.execPath, ['probe.cjs'], appDir);
} finally {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(appDir, { recursive: true, force: true });
}
