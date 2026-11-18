// Shared setting keys go to the pod; a phone's own keys, and the card state a mark carries, stay here.
import { deleteSetting, getSetting, setSetting } from '@/lib/database/services/setting-service';
import { testHost } from '@/test/helpers';

type Sent = { name: string; args: unknown[] };
const sent: Sent[] = [];
beforeEach(() => {
  sent.length = 0;
  testHost.podCommand = async (c) => {
    sent.push(c);
    return {};
  };
});

it('a shared key sends one command and writes nothing here', async () => {
  await setSetting('app_language', 'nl');
  expect(sent).toEqual([expect.objectContaining({ name: 'setSetting', args: ['app_language', 'nl'] })]);
  delete testHost.podCommand;
  expect(await getSetting('app_language')).toBeNull();
});

it('a key of the phone alone writes here and sends nothing', async () => {
  await setSetting('some_phone_key', 'x');
  expect(sent).toEqual([]);
  expect(await getSetting('some_phone_key')).toBe('x');
});

it('the card state is a mark: it writes here and sends nothing', async () => {
  await setSetting('feed_card_state_v1', '{}');
  expect(sent).toEqual([]);
  expect(await getSetting('feed_card_state_v1')).toBe('{}');
});

it('deleting a shared key sends one command, and a phone key deletes here', async () => {
  await setSetting('some_phone_key', 'x');
  await deleteSetting('some_phone_key');
  expect(sent).toEqual([]);
  expect(await getSetting('some_phone_key')).toBeNull();

  await deleteSetting('app_language');
  expect(sent).toEqual([expect.objectContaining({ name: 'deleteSetting', args: ['app_language'] })]);
});

it('with no sink a shared key writes here', async () => {
  delete testHost.podCommand;
  await setSetting('app_language', 'nl');
  expect(await getSetting('app_language')).toBe('nl');
});
