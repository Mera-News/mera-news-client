// The restart gate against the test host: departures, the foreground wait, holds, blocked routes.
// jest runs with __DEV__ true, so a reload goes through the host's devReload.
import { getSetting } from '@/lib/database/services/setting-service';
import {
  __resetAppRestartForTests,
  departureMark,
  holdRestart,
  requestRestart,
  RESTART_MARKER_KEY,
  whenForeground,
} from '@/lib/app-restart';
import { setAppState, testHost } from '@/test/helpers';

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

async function pending(p: Promise<void>): Promise<boolean> {
  let done = false;
  p.then(() => {
    done = true;
  });
  await settled();
  return !done;
}

let devReload: jest.Mock;

beforeEach(() => {
  __resetAppRestartForTests();
  setAppState('active');
  process.env.EXPO_PUBLIC_DEV_RESTORE_TEST = '1';
  devReload = jest.fn();
  testHost.devReload = devReload;
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_DEV_RESTORE_TEST;
});

test('inactive is not a departure, background is', () => {
  const left = departureMark();
  setAppState('inactive');
  expect(left()).toBe(false);
  setAppState('background');
  expect(left()).toBe(true);
});

test('whenForeground waits in the background and resolves on active', async () => {
  setAppState('background');
  const wait = whenForeground();
  expect(await pending(wait)).toBe(true);
  setAppState('inactive');
  expect(await pending(wait)).toBe(true);
  setAppState('active');
  await expect(wait).resolves.toBeUndefined();
});

test('whenForeground returns at once unless the app is in the background', async () => {
  expect(await pending(whenForeground())).toBe(false);
  setAppState('inactive');
  expect(await pending(whenForeground())).toBe(false);
});

test('whenForeground resolves when its signal aborts', async () => {
  setAppState('background');
  const abort = new AbortController();
  const wait = whenForeground(abort.signal);
  expect(await pending(wait)).toBe(true);
  abort.abort();
  await expect(wait).resolves.toBeUndefined();
});

test('a held restart does not reload; after release the next request reloads once and writes the marker', async () => {
  const release = holdRestart('x');
  await requestRestart('update');
  expect(devReload).not.toHaveBeenCalled();
  expect(await getSetting(RESTART_MARKER_KEY)).toBeNull();

  release();
  await requestRestart('update');
  expect(devReload).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await getSetting(RESTART_MARKER_KEY)) as string)).toMatchObject({ reason: 'update' });
});

test('a blocked route does not reload', async () => {
  testHost.getCurrentPathname = () => '/login';
  await requestRestart('update');
  expect(devReload).not.toHaveBeenCalled();
});

test('without the dev flag nothing reloads and nothing throws', async () => {
  delete process.env.EXPO_PUBLIC_DEV_RESTORE_TEST;
  await expect(requestRestart('update')).resolves.toBeUndefined();
  expect(devReload).not.toHaveBeenCalled();
});
