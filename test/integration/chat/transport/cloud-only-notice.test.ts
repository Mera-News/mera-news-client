// The one in-app notice for a cloud-only action tried on-device. The dialog is asserted through the
// host's dialog member, the copy through the keys the host's i18n returns (it has no strings, so `t(key)` is
// the key), and the mode through the real mera-protocol store and the persisted row.
import { setSetting } from '@/lib/database/services/setting-service';
import { ProcessingMode } from '@/lib/generated/graphql-types';
import { blockIfOnDevice, cloudOnlyNoticeText } from '@/lib/llm/cloud-only-notice';
import { __resetOnDeviceGateForTests } from '@/lib/llm/on-device-gate';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
import { testHost } from '@/test/helpers';

const NOTICE = 'chat.cloudOnlyNotice';
const showDialog = jest.fn(async () => true);

beforeEach(async () => {
  __resetOnDeviceGateForTests();
  showDialog.mockClear();
  testHost.showDialog = showDialog;
  useMeraProtocolStore.setState({ processingMode: ProcessingMode.Cloud });
});

afterEach(() => {
  useMeraProtocolStore.setState({ processingMode: ProcessingMode.Cloud });
});

it('in cloud mode it lets the action run and shows nothing', async () => {
  expect(await blockIfOnDevice()).toBe(false);
  expect(showDialog).not.toHaveBeenCalled();
});

it('on-device it blocks and shows ONE in-app dialog with the shared copy', async () => {
  useMeraProtocolStore.setState({ processingMode: ProcessingMode.OnDevice });

  expect(await blockIfOnDevice()).toBe(true);

  expect(showDialog).toHaveBeenCalledTimes(1);
  expect(showDialog).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'meraProtocol.title', body: NOTICE, confirmLabel: 'common.ok' }),
  );
  expect(cloudOnlyNoticeText()).toBe(NOTICE);
});

it('blocks on the persisted on-device row while the store is still on its Cloud default', async () => {
  await setSetting('mera_processing_mode', ProcessingMode.OnDevice);

  expect(await blockIfOnDevice()).toBe(true);
  expect(showDialog).toHaveBeenCalledTimes(1);
});

it('is a one-button notice: no cancel label', async () => {
  useMeraProtocolStore.setState({ processingMode: ProcessingMode.OnDevice });
  await blockIfOnDevice();
  const [[options]] = showDialog.mock.calls as unknown as [[{ cancelLabel?: string }]];
  expect(options.cancelLabel).toBeUndefined();
});
