// endpoints.ts reads process.env.EXPO_PUBLIC_* at module load, through the host's env. Each case
// loads it in a fresh module registry (jest.isolateModules) with a fresh test host registered, so
// the module sees the env as the case set it.

type Sentry = typeof import('@/test/helpers/platform-host').sentryCalls;
let sentry: Sentry;

function load(): any {
  let mod: unknown;
  jest.isolateModules(() => {
    const host = require('@/test/helpers/platform-host') as typeof import('@/test/helpers/platform-host');
    host.installTestPlatform();
    sentry = host.sentryCalls;
    mod = require('@/lib/config/endpoints');
  });
  return mod;
}

// The integration setup points the three endpoints at loopback. These tests rewrite
// process.env, so put it back after each one.
const ENV_AT_LOAD = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_AT_LOAD)) delete process.env[key];
  }
  Object.assign(process.env, ENV_AT_LOAD);
});

describe('config/endpoints', () => {
  const REQUIRED_VARS = {
    EXPO_PUBLIC_INFERENCE_ENDPOINT: 'https://inference.test',
    EXPO_PUBLIC_AUTH_ENDPOINT: 'https://auth.test',
    EXPO_PUBLIC_GRAPHQL_SERVER_ENDPOINT: 'https://api.test',
  };

  function setEnv(overrides: Partial<typeof REQUIRED_VARS> = {}) {
    Object.assign(process.env, REQUIRED_VARS, overrides);
  }

  function clearEnv() {
    for (const key of Object.keys(REQUIRED_VARS)) {
      delete process.env[key];
    }
  }

  afterEach(() => {
    clearEnv();
  });

  it('exports INFERENCE_ENDPOINT when env var is set', () => {
    setEnv();
    const { INFERENCE_ENDPOINT } = load();
    expect(INFERENCE_ENDPOINT).toBe('https://inference.test');
  });

  it('exports AUTH_ENDPOINT when env var is set', () => {
    setEnv();
    const { AUTH_ENDPOINT } = load();
    expect(AUTH_ENDPOINT).toBe('https://auth.test');
  });

  it('exports GRAPHQL_SERVER_ENDPOINT when env var is set', () => {
    setEnv();
    const { GRAPHQL_SERVER_ENDPOINT } = load();
    expect(GRAPHQL_SERVER_ENDPOINT).toBe('https://api.test');
  });

  it('throws when INFERENCE_ENDPOINT is missing', () => {
    setEnv({ EXPO_PUBLIC_INFERENCE_ENDPOINT: undefined } as any);
    delete process.env.EXPO_PUBLIC_INFERENCE_ENDPOINT;
    expect(() => load()).toThrow(
      /Missing required env var EXPO_PUBLIC_INFERENCE_ENDPOINT/,
    );
  });

  it('throws when AUTH_ENDPOINT is missing', () => {
    setEnv();
    delete process.env.EXPO_PUBLIC_AUTH_ENDPOINT;
    expect(() => load()).toThrow(
      /Missing required env var EXPO_PUBLIC_AUTH_ENDPOINT/,
    );
  });

  it('throws when GRAPHQL_SERVER_ENDPOINT is missing', () => {
    setEnv();
    delete process.env.EXPO_PUBLIC_GRAPHQL_SERVER_ENDPOINT;
    expect(() => load()).toThrow(
      /Missing required env var EXPO_PUBLIC_GRAPHQL_SERVER_ENDPOINT/,
    );
  });

  it('reports to Sentry before throwing on missing env var', () => {
    delete process.env.EXPO_PUBLIC_INFERENCE_ENDPOINT;
    delete process.env.EXPO_PUBLIC_AUTH_ENDPOINT;
    delete process.env.EXPO_PUBLIC_GRAPHQL_SERVER_ENDPOINT;
    try {
      load();
    } catch {
      // expected
    }
    expect(sentry.exceptions[0].exception).toBeInstanceOf(Error);
    expect(sentry.exceptions[0].context?.tags?.module).toBe('config/endpoints');
  });

  it('exports DUMP_QUERIES_ENABLED as false when env var is not set', () => {
    setEnv();
    delete process.env.EXPO_PUBLIC_DUMP_QUERY_FOR_DEBUGGING;
    const { DUMP_QUERIES_ENABLED } = load();
    // __DEV__ is true in tests, but value is 'true' check: undefined !== 'true' → false
    expect(DUMP_QUERIES_ENABLED).toBe(false);
  });

  it('exports DUMP_QUERIES_ENABLED as true when __DEV__ and env var both are true', () => {
    setEnv();
    process.env.EXPO_PUBLIC_DUMP_QUERY_FOR_DEBUGGING = 'true';
    // __DEV__ is true in jest globals
    const { DUMP_QUERIES_ENABLED } = load();
    expect(DUMP_QUERIES_ENABLED).toBe(true);
    delete process.env.EXPO_PUBLIC_DUMP_QUERY_FOR_DEBUGGING;
  });

  // The Intercom trio must degrade to '' rather than throw. A missing support
  // key is a supported configuration (the UI falls back to mailto:), so
  // routing these through requireEnv would take out launch for every user.
  it('exports the Intercom keys as empty strings when unset', () => {
    setEnv();
    for (const key of [
      'EXPO_PUBLIC_INTERCOM_APP_ID',
      'EXPO_PUBLIC_INTERCOM_IOS_KEY',
      'EXPO_PUBLIC_INTERCOM_ANDROID_KEY',
    ]) {
      delete process.env[key];
    }
    const mod = load();
    expect(mod.INTERCOM_APP_ID).toBe('');
    expect(mod.INTERCOM_IOS_KEY).toBe('');
    expect(mod.INTERCOM_ANDROID_KEY).toBe('');
    expect(sentry.exceptions).toHaveLength(0);
  });

  it('exports the Intercom keys when set', () => {
    setEnv();
    process.env.EXPO_PUBLIC_INTERCOM_APP_ID = 'abc12345';
    process.env.EXPO_PUBLIC_INTERCOM_IOS_KEY = 'ios_sdk-test';
    process.env.EXPO_PUBLIC_INTERCOM_ANDROID_KEY = 'android_sdk-test';
    const mod = load();
    expect(mod.INTERCOM_APP_ID).toBe('abc12345');
    expect(mod.INTERCOM_IOS_KEY).toBe('ios_sdk-test');
    expect(mod.INTERCOM_ANDROID_KEY).toBe('android_sdk-test');
    for (const key of [
      'EXPO_PUBLIC_INTERCOM_APP_ID',
      'EXPO_PUBLIC_INTERCOM_IOS_KEY',
      'EXPO_PUBLIC_INTERCOM_ANDROID_KEY',
    ]) {
      delete process.env[key];
    }
  });

  it('throws an Error with a helpful message mentioning .env.example', () => {
    delete process.env.EXPO_PUBLIC_AUTH_ENDPOINT;
    try {
      setEnv({ EXPO_PUBLIC_AUTH_ENDPOINT: undefined } as any);
      delete process.env.EXPO_PUBLIC_AUTH_ENDPOINT;
      load();
      fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toMatch(/\.env\.example/);
    }
  });
});
