// The platform contract: facades read the host at call time, name themselves when nothing is
// registered, and fall back to their documented default when the host leaves a member out.
import { __resetPlatformForTests, PlatformNotRegisteredError, registerPlatform, type PlatformHost } from '@/lib/platform';
import { AppState } from '@/lib/platform/react-native';
import SQLiteAdapter from '@/lib/platform/sqlite-adapter';
import { hapticLight } from '@/lib/platform/haptics';
import { canTranslateIntoLanguage } from '@/lib/platform/translation';
import { env } from '@/lib/platform/env';
import { getJwtToken } from '@/lib/platform/auth';

function host(over: Partial<PlatformHost> = {}): PlatformHost {
  return { env: {}, appState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, ...over } as PlatformHost;
}

afterEach(() => __resetPlatformForTests());

it('throws, naming the facade, when read before registration', () => {
  expect(() => AppState.currentState).toThrow(PlatformNotRegisteredError);
  expect(() => AppState.currentState).toThrow('lib/platform/react-native');
  expect(() => getJwtToken()).toThrow('lib/platform/auth');
});

it('reads the host at the time of each read', () => {
  const appState = { currentState: 'active' as const, addEventListener: () => ({ remove() {} }) };
  registerPlatform(host({ appState, env: { EXPO_PUBLIC_X: 'a' } }));
  expect(AppState.currentState).toBe('active');
  (appState as { currentState: string }).currentState = 'background';
  expect(AppState.currentState).toBe('background');
  expect(env.EXPO_PUBLIC_X).toBe('a');
});

it('refuses a second registration', () => {
  registerPlatform(host());
  expect(() => registerPlatform(host())).toThrow('twice');
});

it('builds the database adapter through the host', () => {
  const adapter = { kind: 'host adapter' };
  const createDatabaseAdapter = jest.fn(() => adapter);
  registerPlatform(host({ createDatabaseAdapter } as unknown as Partial<PlatformHost>));
  const options = { schema: { version: 1, tables: {} }, jsi: true } as never;
  expect(new SQLiteAdapter(options)).toBe(adapter);
  expect(createDatabaseAdapter).toHaveBeenCalledWith(options);
});

it('uses the documented default for an optional member the host leaves out', async () => {
  registerPlatform(host());
  await expect(hapticLight()).resolves.toBeUndefined();
  expect(canTranslateIntoLanguage('nl')).toBe(false);
});
