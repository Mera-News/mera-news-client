// The plain OpenAI-compatible model transport, driven through the same entry points the client
// uses (cloudComplete, cloudBatchComplete, cloudChatStream). The model is an MSW handler on
// http://model.test/v1; nothing may reach the gateway mock.
import { cloudBatchComplete, cloudChatStream, cloudComplete } from '@/lib/llm/cloudComplete';
import { EmptyReplyError } from '@/lib/llm/gateway-fetch';
import { OnDeviceModeError } from '@/lib/llm/on-device-gate';
import { HARNESS_FILES } from '@/lib/harnesses';
import { createOpenAiTransport, type OpenAiTransportConfig } from '@/lib/llm/openai-transport';
import { attestationRequests, gatewayCalls, http, HttpResponse, sentryCalls, server, testHost } from '@/test/helpers';
import { resetChatModules, setProcessingMode } from '@/test/integration/chat/_helpers';
import { errorOf, fakeClock, run } from './transport-kit';

jest.setTimeout(30_000);

const URL = 'http://model.test/v1/chat/completions';
const reply = (content: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ choices: [{ message: { content, ...extra } }] });

interface Seen {
  headers: Headers;
  body: Record<string, unknown>;
  at: number;
}

/** Serves `answer` at the model URL and records every request. */
function serve(answer: (seen: Seen) => Response | Promise<Response> = () => reply('ok')): Seen[] {
  const seen: Seen[] = [];
  server.use(
    http.post(URL, async ({ request }) => {
      const entry = { headers: request.headers, body: (await request.json()) as Record<string, unknown>, at: Date.now() };
      seen.push(entry);
      return answer(entry);
    }),
  );
  return seen;
}

const use = (extra: Partial<OpenAiTransportConfig> = {}) => {
  const transport = createOpenAiTransport({ baseUrl: 'http://model.test/v1/', apiKey: 'sk-test', model: 'm1', ...extra });
  testHost.llmTransport = transport;
  return transport;
};

const ask = (extra: Record<string, unknown> = {}) => cloudComplete({ systemPrompt: 'sys', prompt: 'hello', ...extra });

beforeEach(() => {
  resetChatModules();
});

afterEach(() => {
  expect(gatewayCalls()).toEqual([]);
  expect(attestationRequests()).toBe(0);
});

describe('the OpenAI transport request', () => {
  it('sends the plain body with the bearer header and no template kwargs', async () => {
    const seen = serve(() => reply('  hi there  '));
    const transport = use();
    expect(transport.asyncJobs).toBe(false);

    expect(await ask()).toBe('hi there');

    expect(seen).toHaveLength(1);
    expect(seen[0].body).toEqual({
      model: 'm1',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ],
      stream: false,
      temperature: 0.3,
    });
    expect(seen[0].headers.get('authorization')).toBe('Bearer sk-test');
    expect(seen[0].headers.get('content-type')).toBe('application/json');
    expect(transport.inFlight()).toBe(0);
  });

  it('passes temperature and the token limit through', async () => {
    const seen = serve();
    use();
    await ask({ temperature: 0.9, maxCompletionTokens: 77 });
    expect(seen[0].body).toMatchObject({ temperature: 0.9, max_tokens: 77 });
  });

  it('sends no Authorization header without an api key', async () => {
    const seen = serve();
    use({ apiKey: undefined });
    await ask();
    expect(seen[0].headers.has('authorization')).toBe(false);
  });

  it('sends enable_thinking false for a harness that names the quirk, and never the private flag', async () => {
    HARNESS_FILES['thinking-off-test'] = { extends: 'cloud-base', params: { quirks: ['thinking-off-kwarg'] } };
    try {
      const seen = serve();
      use({ harnessFolder: 'thinking-off-test' });
      await ask();
      await cloudBatchComplete([{ id: 'a', system: 's', prompt: 'p', enableThinking: true }]);
      expect(seen[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(seen[1].body.chat_template_kwargs).toEqual({ enable_thinking: true });
      expect(seen.every((s) => !('__enableThinking' in s.body))).toBe(true);
    } finally {
      delete HARNESS_FILES['thinking-off-test'];
    }
  });
});

describe('the no-sampling quirk', () => {
  it('a host quirk drops temperature and top_p from every leg, for endpoints that refuse them', async () => {
    const seen = serve();
    use({ quirks: ['no-sampling'] });
    await ask({ temperature: 0.2, topP: 0.9 });
    await cloudBatchComplete([{ id: 'a', system: 's', prompt: 'p', temperature: 0.1, maxTokens: 50 }], 'scoring');
    expect(seen[0].body).not.toHaveProperty('temperature');
    expect(seen[1].body).not.toHaveProperty('temperature');
    expect(seen[1].body).toMatchObject({ max_tokens: 50 });
  });

  it('an unknown host quirk throws when the transport is made', () => {
    expect(() => use({ quirks: ['no-such-quirk'] })).toThrow('unknown quirk "no-such-quirk"');
  });
});

describe('the OpenAI transport batch', () => {
  it('keeps input order under uneven delays and puts a failure on its own row', async () => {
    fakeClock();
    server.use(
      http.post(URL, async ({ request }) => {
        const body = (await request.json()) as { messages: { content: string }[] };
        const prompt = body.messages[1].content;
        const delayMs = { p0: 300, p1: 10, p2: 100, p3: 1 }[prompt] ?? 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return prompt === 'p2' ? new HttpResponse('nope', { status: 400 }) : reply(`out ${prompt}`);
      }),
    );
    use({ concurrency: 2 });
    const calls = ['p0', 'p1', 'p2', 'p3'].map((p) => ({ id: p, system: 's', prompt: p }));

    const results = await run(cloudBatchComplete(calls, 'scoring'));

    expect(results.map((r) => r.id)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(results.map((r) => r.output)).toEqual(['out p0', 'out p1', '', 'out p3']);
    expect(results[2].error).toContain('400');
    expect(results.filter((r) => r.error)).toHaveLength(1);
  });

  it('keeps at most the configured number of requests open', async () => {
    fakeClock();
    let open = 0;
    let peak = 0;
    server.use(
      http.post(URL, async () => {
        peak = Math.max(peak, ++open);
        await new Promise((resolve) => setTimeout(resolve, 50));
        open--;
        return reply('ok');
      }),
    );
    const transport = use({ concurrency: 2 });
    const calls = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, system: 's', prompt: 'p' }));
    const pending = cloudBatchComplete(calls);
    const results = await run(pending);
    expect(results.map((r) => r.output)).toEqual(Array(5).fill('ok'));
    expect(peak).toBe(2);
    expect(transport.inFlight()).toBe(0);
  });

  it('omits temperature when a batch item has none', async () => {
    const seen = serve();
    use();
    await cloudBatchComplete([{ id: 'a', system: 's', prompt: 'p' }]);
    expect('temperature' in seen[0].body).toBe(false);
  });
});

describe('the OpenAI transport failures', () => {
  it('waits Retry-After after a 429, then succeeds', async () => {
    fakeClock();
    let n = 0;
    const seen = serve(() => (n++ === 0 ? new HttpResponse('slow down', { status: 429, headers: { 'Retry-After': '1' } }) : reply('ok')));
    use();

    expect(await run(ask())).toBe('ok');

    expect(seen).toHaveLength(2);
    expect(seen[1].at - seen[0].at).toBeGreaterThanOrEqual(1000);
    expect(seen[1].at - seen[0].at).toBeLessThan(2000);
  });

  it('gives up after three 503 answers with the status on the error', async () => {
    fakeClock();
    const seen = serve(() => new HttpResponse('down', { status: 503 }));
    use();

    const err = await errorOf(run(ask()));

    expect(seen).toHaveLength(3);
    expect(err).toMatchObject({ statusCode: 503, responseBody: 'down' });
    expect(seen[1].at - seen[0].at).toBe(1000);
    expect(seen[2].at - seen[1].at).toBe(2000);
  });

  it('does not retry a 401', async () => {
    const seen = serve(() => new HttpResponse('bad key', { status: 401 }));
    use();
    const err = await errorOf(ask());
    expect(seen).toHaveLength(1);
    expect(err).toMatchObject({ statusCode: 401, message: 'model request failed: 401' });
  });

  it('retries a network error', async () => {
    let n = 0;
    server.use(http.post(URL, () => (n++ === 0 ? HttpResponse.error() : reply('ok'))));
    fakeClock();
    use();
    expect(await run(ask())).toBe('ok');
    expect(n).toBe(2);
  });

  it('throws EmptyReplyError on a blank body and names a reasoning-only answer', async () => {
    serve(() => new HttpResponse('   ', { status: 200 }));
    use();
    expect(await errorOf(ask())).toBeInstanceOf(EmptyReplyError);

    serve(() => reply('', { reasoning_content: 'thinking' }));
    expect((await errorOf(ask()))?.message).toBe('[OpenAiTransport] reasoning-overran-budget');

    serve(() => reply(''));
    expect(await ask()).toBe('');
  });

  it('a caller stop ends a retry wait at once', async () => {
    fakeClock();
    const seen = serve(() => new HttpResponse('down', { status: 503, headers: { 'Retry-After': '60' } }));
    use();
    const stop = new AbortController();
    const started = Date.now();
    setTimeout(() => stop.abort(), 1000);

    const err = await errorOf(run(cloudComplete({ systemPrompt: 'sys', prompt: 'hello' }, { signal: stop.signal })));

    expect(err?.name).toBe('CallerAbortError');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(seen).toHaveLength(1);
  });

  it('never puts the api key in an error or a report', async () => {
    const key = 'sk-secret-4f8a1c';
    const errors: unknown[] = [];
    server.use(http.post(URL, () => new HttpResponse('bad key', { status: 401 })));
    use({ apiKey: key });
    errors.push(await errorOf(ask()));
    server.use(http.post(URL, () => HttpResponse.error()));
    fakeClock();
    errors.push(await errorOf(run(ask())));

    const everything = JSON.stringify([
      errors.map((e) => ({ message: (e as Error).message, stack: (e as Error).stack, ...(e as object) })),
      sentryCalls,
    ]);
    expect(everything).not.toContain(key);
  });

  it('aborts at the call timeout without retrying', async () => {
    fakeClock();
    let n = 0;
    server.use(
      http.post(URL, () => {
        n++;
        return new Promise<Response>(() => undefined);
      }),
    );
    use({ callTimeoutMs: 5000 });

    const err = await errorOf(run(ask()));

    expect(err).toMatchObject({ name: 'TimeoutError', message: 'the model took longer than the call timeout' });
    expect(n).toBe(1);
  });
});

describe('the OpenAI transport modes', () => {
  afterEach(async () => {
    await setProcessingMode('cloud');
  });

  it('refuses complete and batch in on-device mode and sends nothing', async () => {
    const seen = serve();
    use();
    await setProcessingMode('on-device');

    expect(await errorOf(ask())).toBeInstanceOf(OnDeviceModeError);
    expect(await errorOf(cloudBatchComplete([{ id: 'a', system: 's', prompt: 'p' }]))).toBeInstanceOf(OnDeviceModeError);
    expect(seen).toHaveLength(0);
  });
});
