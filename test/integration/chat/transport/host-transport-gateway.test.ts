// A host that brings its own model transport reaches nothing of Mera's gateway: not the readiness
// warm-up, not web search, not the quick fact check. Without a host transport the same three do reach it.
import { handleQuickFactCheck, startFactCheckFromAction } from '@/lib/chat-tools/quick-fact-check-handler';
import { makeAgentToolPort } from '@/lib/chat-tools/agent-device-port';
import { handleWebSearch } from '@/lib/chat-tools/web-search-handler';
import { ArticleFeedbackAgent } from '@/lib/llm/agents/ArticleFeedbackAgent';
import { FollowStoryAgent } from '@/lib/llm/agents/FollowStoryAgent';
import { PersonaUpdateAgent } from '@/lib/llm/agents/PersonaUpdateAgent';
import { usesGateway } from '@/lib/llm/cloudComplete';
import { prewarmCloudChat, useChatReadiness } from '@/lib/llm/prewarm';
import { searchWeb, searchWebBatch } from '@/lib/web-search/web-search-client';
import { attestationRequests, gatewayCalls, mockGateway, server, testHost } from '@/test/helpers';
import { resetChatModules, setProcessingMode, setWebSearchInChat } from '@/test/integration/chat/_helpers';
import { toolNames } from '@/test/integration/chat/tools/agents/agents-kit';
import { hostTransport } from './host-transport-kit';

jest.setTimeout(30_000);

/** Lets fire-and-forget work run to its first network request. */
async function flush(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Waits for a request the negative controls must see; a slow machine needs more than a few turns. */
async function eventually(cond: () => boolean, ms = 5_000): Promise<void> {
  for (const end = Date.now() + ms; !cond() && Date.now() < end; ) await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Requests that reached the gateway's search route, whether or not the mock recorded them. */
function watchSearchRequests(): () => number {
  let n = 0;
  server.events.on('request:start', ({ request }) => {
    if (new URL(request.url).pathname.endsWith('/v1/web-search')) n += 1;
  });
  return () => n;
}

const CLAIM = { claim: 'The Eiffel Tower is 330 metres tall.', articleTitle: 'Tower news', publicationName: 'Daily' };

beforeEach(async () => {
  resetChatModules();
  await setProcessingMode('cloud');
  await setWebSearchInChat(true);
});
afterEach(() => server.events.removeAllListeners());

describe('with a host transport', () => {
  beforeEach(() => {
    testHost.llmTransport = hostTransport();
  });
  afterEach(() => {
    expect(gatewayCalls()).toEqual([]);
    expect(attestationRequests()).toBe(0);
  });

  it('says the gateway is not in use', () => {
    expect(usesGateway()).toBe(false);
  });

  it('prewarm leaves readiness idle and warms nothing', async () => {
    prewarmCloudChat();
    prewarmCloudChat({ ping: true });
    await flush();
    expect(useChatReadiness.getState().status).toBe('idle');
  });

  it('does not offer web search to the model, whatever the setting says', () => {
    expect(toolNames(new PersonaUpdateAgent('u', 'CONFIG'))).not.toContain('webSearch');
    expect(toolNames(new ArticleFeedbackAgent('u', { articleId: 'a1' }))).not.toContain('webSearch');
    expect(toolNames(new FollowStoryAgent('u'))).not.toContain('webSearch');
    expect(makeAgentToolPort('msg').webSearch).toBeUndefined();
  });

  it('answers a direct web search as unavailable without a request', async () => {
    const requests = watchSearchRequests();

    const result = await handleWebSearch({ queries: ['one thing', 'another thing'] });
    const single = await handleWebSearch({ query: 'one thing' });

    expect(result.searched).toBe(false);
    expect(single.searched).toBe(false);
    expect(await searchWeb('one thing')).toMatchObject({ ok: false, code: 'search-unavailable' });
    expect(await searchWebBatch(['one thing', 'another thing'])).toMatchObject({ ok: false, code: 'search-unavailable' });
    expect(requests()).toBe(0);
  });

  it('does not offer the fact check proposal', () => {
    expect(toolNames(new ArticleFeedbackAgent('u', { articleId: 'a1' }))).not.toContain('proposeFactCheck');
  });

  it('answers a quick fact check as search-unavailable without a request', async () => {
    const requests = watchSearchRequests();

    const answer = await handleQuickFactCheck(CLAIM);

    expect(answer.outcome).toBe('search-unavailable');
    expect(answer.verdict).toBeNull();
    expect(requests()).toBe(0);
  });

  it('a started claim check settles as search-unavailable', async () => {
    const { useFloatingChatStore } = await import('@/lib/stores/floating-chat-store');
    const subject = { surface: 'fact-check-chat', articleId: 'a1', articleTitle: 'Tower news' };
    startFactCheckFromAction({ type: 'fact_check_claim', label: 'Height', claim: CLAIM.claim, subject });
    await flush();
    expect(JSON.stringify(useFloatingChatStore.getState())).toContain('search-unavailable');
  });
});

describe('without a host transport', () => {
  it('says the gateway is in use', () => {
    expect(usesGateway()).toBe(true);
  });

  it('prewarm reaches the gateway', async () => {
    server.use(...mockGateway(() => 'unexpected'));
    prewarmCloudChat({ ping: true });
    await eventually(() => attestationRequests() + gatewayCalls().length > 0);
    expect(attestationRequests() + gatewayCalls().length).toBeGreaterThan(0);
  });

  it('offers web search and a direct search reaches the gateway', async () => {
    server.use(...mockGateway((call) => (call.route === 'web-search' ? JSON.stringify([{ title: 'T', url: 'https://e.com', snippet: 'S' }]) : 'unexpected')));
    expect(toolNames(new PersonaUpdateAgent('u', 'CONFIG'))).toContain('webSearch');
    expect(toolNames(new ArticleFeedbackAgent('u', { articleId: 'a1' }))).toContain('webSearch');
    expect(toolNames(new FollowStoryAgent('u'))).toContain('webSearch');
    expect(makeAgentToolPort('msg').webSearch).toBeDefined();

    const result = await handleWebSearch({ query: 'one thing' });

    expect(result.searched).toBe(true);
    expect(gatewayCalls('web-search')).toHaveLength(1);
  });

  it('offers the fact check proposal and a quick check searches through the gateway', async () => {
    server.use(...mockGateway((call) => (call.route === 'web-search' ? JSON.stringify([]) : 'unexpected')));
    expect(toolNames(new ArticleFeedbackAgent('u', { articleId: 'a1' }))).toContain('proposeFactCheck');

    await handleQuickFactCheck(CLAIM);

    expect(gatewayCalls('web-search').length).toBeGreaterThan(0);
  });
});
