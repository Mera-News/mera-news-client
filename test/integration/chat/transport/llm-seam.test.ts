// The three cloud calls go through the transport seam (cloudComplete.ts -> gateway-transport.ts)
// and reach the mock gateway sealed, authorised with the host's JWT.
import { cloudBatchComplete, cloudChatStream, cloudComplete } from '@/lib/llm/cloudComplete';
import { gatewayTransport } from '@/lib/llm/gateway-transport';
import { authState, gatewayCalls, mockGateway, server } from '@/test/helpers';

test('the three cloud calls reach the gateway through the transport, sealed, with the host JWT', async () => {
  const seam = {
    complete: jest.spyOn(gatewayTransport, 'complete'),
    batch: jest.spyOn(gatewayTransport, 'batch'),
    chat: jest.spyOn(gatewayTransport, 'chat'),
  };
  server.use(...mockGateway((call) => (call.route === 'chat' && call.stream ? { chunks: ['he', 'llo'] } : 'ok')));

  await expect(cloudComplete({ systemPrompt: 's', prompt: 'p' })).resolves.toBe('ok');
  const batch = await cloudBatchComplete([{ id: 'a', system: 's', prompt: 'p' }]);
  expect(batch.map((r) => r.output)).toEqual(['ok']);
  let text = '';
  for await (const e of cloudChatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
    if (e.type === 'text-delta') text += e.delta;
  }
  expect(text).toBe('hello');

  expect([seam.complete, seam.batch, seam.chat].map((s) => s.mock.calls.length)).toEqual([1, 1, 1]);
  expect(seam.batch.mock.calls[0][1]).toBe('background');
  const calls = gatewayCalls();
  expect(calls.map((c) => c.route)).toEqual(['chat', 'batch', 'chat']);
  expect(calls.every((c) => c.headers.authorization === `Bearer ${authState.jwt}`)).toBe(true);
});
