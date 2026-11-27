// Qwen3.6-35B truncates persona turns with thinking on (12 of 19), so its harness says
// `thinking: false` and the transport forces it off on that profile, whatever the request asked.
import { makeAgentDeps } from '@/lib/chat-tools/agent-device-port';
import { PROFILES } from '@/lib/llm/profiles';
import { __resetRouterForTests, reportProfileFailure } from '@/lib/llm/router';
import { mockGateway, server } from '@/test/helpers';
import { resetChatModules } from '@/test/integration/chat/_helpers';
import { captureChatBodies } from '@/test/integration/chat/streaming/support';

jest.setTimeout(30_000);

beforeEach(async () => {
  resetChatModules();
  server.use(...mockGateway(() => 'ok'));
});
afterEach(() => __resetRouterForTests());

const req = { role: 'tool' as const, model: 'BIG', systemPrompt: 's', messages: [{ role: 'user' as const, content: 'm' }], enableThinking: true };

describe('thinking per harness', () => {
  it('forces thinking off on Qwen3.6 and honours the request once the router moved to Qwen3.8', async () => {
    const bodies = captureChatBodies();
    const deps = makeAgentDeps('msg', jest.fn());

    await deps.callModel(req);
    expect(JSON.parse(bodies[0])).toMatchObject({ model: 'Qwen/Qwen3.6-35B-A3B-FP8', chat_template_kwargs: { enable_thinking: false } });

    // The mock serves only NEAR-shaped attestation, so past Qwen3.6 the chain answers on NEAR Qwen3.8.
    reportProfileFailure(PROFILES['near/qwen3.6-35b-a3b'], 'chat-tools', 'deadline');
    await deps.callModel(req);
    expect(JSON.parse(bodies.at(-1)!)).toMatchObject({ model: 'Qwen/Qwen3.8-27B', chat_template_kwargs: { enable_thinking: true } });
  });
});
