// The test host is registered by the integration setup and reset before each test.
import NetInfo from '@/lib/platform/netinfo';
import { AppState } from '@/lib/platform/react-native';
import { captureException } from '@/lib/platform/sentry';
import { secureStore } from '@/lib/platform/secure-store';
import i18n from '@/lib/platform/i18n';
import { sentryCalls, setNetInfo, testHost } from '../../helpers/platform-host';
import { setAppState } from '../../helpers/app-state';

it('drives AppState and network status through the helpers', async () => {
  setAppState('background');
  expect(AppState.currentState).toBe('background');
  setAppState('active');
  const seen: (boolean | null)[] = [];
  const off = NetInfo.addEventListener((s) => seen.push(s.isConnected));
  setNetInfo({ isConnected: false });
  off();
  expect(seen).toEqual([false]);
});

it('records Sentry calls and keeps keychain semantics', async () => {
  captureException(new Error('x'));
  expect(sentryCalls.exceptions).toHaveLength(1);
  await expect(secureStore.getItemAsync('missing')).resolves.toBeNull();
  expect(i18n.t('some.key')).toBe('some.key');
});

it('starts each test from the defaults', () => {
  expect(sentryCalls.exceptions).toHaveLength(0);
  expect(testHost.onDeviceModel).toBeUndefined();
});
