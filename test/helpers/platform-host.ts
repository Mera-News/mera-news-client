// The platform host every integration test runs on (registered by test/setup/platform.ts).
//
// `testHost` is a plain mutable object: a test drives the client by setting a member on it
// (`testHost.onDeviceModel = fake`, `testHost.updates = {...}`) and the facades read it at call
// time. resetTestPlatform() puts back the defaults below before each test.
//
// Defaults: AppState from ./app-state; keychain and AsyncStorage from ./storage; fetch is the global
// one (MSW patches it); an in-memory LokiJS database; i18next with no strings (t returns the key);
// recorders for Sentry, toasts and the session; every optional host member left out.
import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { DatabaseAdapter } from '@nozbe/watermelondb/adapters/type';
import i18next from 'i18next';
import {
  registerPlatform,
  type Breadcrumb,
  type CaptureContext,
  type NetInfoLike,
  type NetInfoState,
  type NotifiedToastOptions,
  type PlatformHost,
} from '@/lib/platform';
import { appStateModule } from './app-state';
import { asyncStorageModule, resetStorage, secureStoreModule } from './storage';

// --- Recorders ---------------------------------------------------------------------------------

export const sentryCalls = {
  exceptions: [] as { exception: unknown; context?: CaptureContext }[],
  messages: [] as { message: string; context?: CaptureContext }[],
  breadcrumbs: [] as Breadcrumb[],
};

export const toastCalls: { row: unknown; opts: NotifiedToastOptions }[] = [];

/** The session the test host reports. `jwt: null` is a signed-out reader. */
export const authState = {
  jwt: 'test-jwt' as string | null,
  cookie: 'test-cookie' as string | null,
  invalidations: 0,
  failures: 0,
};

// --- Network status, drivable --------------------------------------------------------------------

let netState: NetInfoState = { isConnected: true, isInternetReachable: true, type: 'wifi' };
const netListeners = new Set<(state: NetInfoState) => void>();

const netInfo: NetInfoLike = {
  fetch: async () => netState,
  addEventListener(listener) {
    netListeners.add(listener);
    return () => void netListeners.delete(listener);
  },
};

/** Sets the network status and tells every listener. */
export function setNetInfo(state: Partial<NetInfoState>): void {
  netState = { ...netState, ...state };
  [...netListeners].forEach((fn) => fn(netState));
}

// --- The host ----------------------------------------------------------------------------------

const i18n = i18next.createInstance();
void i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } }, initAsync: false });

const graphqlEndpoint = () => process.env.EXPO_PUBLIC_GRAPHQL_SERVER_ENDPOINT ?? 'http://127.0.0.1:8790';

const apolloClient = new ApolloClient({
  link: new HttpLink({ uri: () => graphqlEndpoint(), fetch: (input, init) => globalThis.fetch(input, init) }),
  cache: new InMemoryCache(),
});

function memoryDatabaseAdapter({ schema }: { schema: ConstructorParameters<typeof LokiJSAdapter>[0]['schema'] }): DatabaseAdapter {
  // In memory, at the schema's version: migrations (the only raw SQL) never run, and `jsi` and
  // `onSetUpError` are ignored. Loki differs from SQLite on UNIQUE errors, `Q.like` and NULL order.
  return new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    extraLokiOptions: { autosave: false },
  } as ConstructorParameters<typeof LokiJSAdapter>[0]);
}

function defaults(): PlatformHost {
  return {
    isDev: true,
    env: process.env,
    appState: appStateModule,
    sentry: {
      captureException: (exception, context) => {
        sentryCalls.exceptions.push({ exception, context });
        return `event-${sentryCalls.exceptions.length}`;
      },
      captureMessage: (message, context) => {
        sentryCalls.messages.push({ message, context });
        return `message-${sentryCalls.messages.length}`;
      },
      addBreadcrumb: (breadcrumb) => void sentryCalls.breadcrumbs.push(breadcrumb),
      setUser: () => {},
      setTag: () => {},
      setExtra: () => {},
      startInactiveSpan: () => ({ end() {} }),
      withScope: (callback) => callback({ setTag() {}, setLevel() {} }),
    },
    fetch: (input, init) => globalThis.fetch(input, init),
    netInfo,
    asyncStorage: asyncStorageModule.default,
    secureStore: secureStoreModule,
    getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US' }],
    auth: {
      getJwtToken: async () => authState.jwt,
      invalidateJwtCache: () => void authState.invalidations++,
      getCookie: () => authState.cookie,
      recordAuthFailure: () => void authState.failures++,
    },
    apolloClient,
    createDatabaseAdapter: memoryDatabaseAdapter,
    i18n,
    showNotifiedToast: (row, opts) => void toastCalls.push({ row, opts }),
  };
}

/** The registered host. Members set on it take effect at the next read. */
export const testHost: PlatformHost = defaults();

let installed = false;

/** Registers testHost. Safe to call more than once in one test file. */
export function installTestPlatform(): void {
  if (installed) return;
  registerPlatform(testHost);
  installed = true;
}

/** Restores testHost's members and clears the recorders, storage and session counters. */
export function resetTestPlatform(): void {
  for (const key of Object.keys(testHost)) delete (testHost as unknown as Record<string, unknown>)[key];
  Object.assign(testHost, defaults());
  sentryCalls.exceptions.length = 0;
  sentryCalls.messages.length = 0;
  sentryCalls.breadcrumbs.length = 0;
  toastCalls.length = 0;
  Object.assign(authState, { jwt: 'test-jwt', cookie: 'test-cookie', invalidations: 0, failures: 0 });
  netState = { isConnected: true, isInternetReachable: true, type: 'wifi' };
  resetStorage();
}
