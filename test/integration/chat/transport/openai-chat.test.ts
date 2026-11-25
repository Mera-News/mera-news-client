// The chat leg of the OpenAI-compatible transport, against a local HTTP server that speaks OpenAI
// SSE over a real socket. The parity cases run the same model text through the E2EE gateway mock
// and through this transport and compare the events.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { cloudChatStream, cloudComplete, type SseEvent } from '@/lib/llm/cloudComplete';
import { CallerAbortError } from '@/lib/llm/gateway-fetch';
import { HARNESS_FILES } from '@/lib/harnesses';
import { APP_TOOL_FORMAT, toTextToolMessages } from '@/lib/harnesses/text-tool-protocol';
import { STREAM_IDLE_TIMEOUT_MS } from '@/lib/llm/chat-response';
import { createOpenAiTransport, type OpenAiTransportConfig } from '@/lib/llm/openai-transport';
import { passthrough } from 'msw';
import { gatewayCalls, http as mswHttp, mockGateway, server, testHost } from '@/test/helpers';
import { resetChatModules } from '@/test/integration/chat/_helpers';
import { toolCall } from '@/test/integration/chat/_helpers/replies';
import { collect, DONE, delta, frame } from '../streaming/support';
import { errorOf } from './transport-kit';

jest.setTimeout(30_000);

interface Seen {
  body: Record<string, any>;
  headers: http.IncomingHttpHeaders;
}
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, seen: Seen) => void | Promise<void>;

const servers: http.Server[] = [];
const closes: string[] = [];

/** A local model endpoint. `seen` holds every request body it received. */
async function listen(handler: Handler) {
  const seen: Seen[] = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const entry = { body: raw ? JSON.parse(raw) : {}, headers: req.headers };
      seen.push(entry);
      res.on('close', () => closes.push('closed'));
      void handler(req, res, entry);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  const baseUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`;
  return { seen, baseUrl };
}

const sse = (res: http.ServerResponse) => res.writeHead(200, { 'content-type': 'text/event-stream' });
const send = (res: http.ServerResponse, texts: string[], finish = 'stop') => {
  sse(res);
  for (const t of texts) res.write(delta({ content: t }));
  res.write(delta({}, finish));
  res.write(DONE);
  res.end();
};

const use = (baseUrl: string, extra: Partial<OpenAiTransportConfig> = {}) => {
  testHost.llmTransport = createOpenAiTransport({ baseUrl, apiKey: 'sk-test', model: 'm1', ...extra });
};

const MESSAGES = [
  { role: 'system' as const, content: 'You are Mera.' },
  { role: 'user' as const, content: 'hello' },
];
const chat = (extra: Record<string, unknown> = {}) => cloudChatStream({ route: 'topics', messages: MESSAGES, ...extra });
const tool = (name: string) => ({
  type: 'function' as const,
  function: { name, description: 'Save a fact.', parameters: { type: 'object' as const, properties: { statement: { type: 'string' } } } },
});

// The local server is a real socket: let it through the request mock.
const allowLocalServer = () =>
  server.use(mswHttp.post(/^http:\/\/127\.0\.0\.1:(?!8790)\d+\/v1\/chat\/completions$/, () => passthrough()));

beforeEach(() => {
  resetChatModules();
  closes.length = 0;
  allowLocalServer();
});

afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

describe('the OpenAI chat leg', () => {
  it('streams a five-delta reply as text deltas and one stop', async () => {
    const { seen, baseUrl } = await listen((_req, res) => send(res, ['one ', 'two ', 'three ', 'four ', 'five']));
    use(baseUrl);
    const events = await collect(chat());
    expect(events).toEqual([
      { type: 'text-delta', delta: 'one ' },
      { type: 'text-delta', delta: 'two ' },
      { type: 'text-delta', delta: 'three ' },
      { type: 'text-delta', delta: 'four ' },
      { type: 'text-delta', delta: 'five' },
      { type: 'finish', reason: 'stop' },
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.authorization).toBe('Bearer sk-test');
    expect(seen[0].headers.accept).toBe('text/event-stream');
    expect(seen[0].body.stream).toBe(true);
    expect(gatewayCalls()).toEqual([]);
  });

  it('reads a JSON reply when the server ignores stream', async () => {
    const { baseUrl } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'whole' }, finish_reason: 'stop' }] }));
    });
    use(baseUrl);
    expect(await collect(chat({ stream: false }))).toEqual([
      { type: 'text-delta', delta: 'whole' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('signals reasoning once and never yields its text', async () => {
    const { baseUrl } = await listen((_req, res) => {
      sse(res);
      res.write(delta({ reasoning_content: 'secret one' }));
      res.write(delta({ reasoning_content: 'secret two' }));
      res.write(delta({ content: 'answer' }));
      res.write(delta({}, 'stop'));
      res.write(DONE);
      res.end();
    });
    use(baseUrl);
    const events = await collect(chat());
    expect(events).toEqual([
      { type: 'reasoning' },
      { type: 'text-delta', delta: 'answer' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('turns a native tool call into an error and stops', async () => {
    const { baseUrl } = await listen((_req, res) => {
      sse(res);
      res.write(delta({ tool_calls: [{ index: 0, id: 'c', function: { name: 'x', arguments: '{}' } }] }));
      res.write(delta({ content: 'after' }));
      res.write(DONE);
      res.end();
    });
    use(baseUrl);
    expect(await collect(chat())).toEqual([{ type: 'error', message: 'unexpected native tool call' }]);
  });

  it('maps finish reasons, with anything unknown an error', async () => {
    const { baseUrl } = await listen((_req, res) => send(res, ['x'], 'content_filter'));
    use(baseUrl);
    const events = await collect(chat());
    expect(events[events.length - 1]).toEqual({ type: 'finish', reason: 'error' });
    const again = await listen((_req, res) => send(res, ['x'], 'length'));
    use(again.baseUrl);
    const lengthEvents = await collect(chat());
    expect(lengthEvents[lengthEvents.length - 1]).toEqual({ type: 'finish', reason: 'length' });
  });
});

describe('parity with the gateway leg', () => {
  const split = (text: string) => {
    const a = Math.floor(text.length / 3);
    const b = Math.floor((text.length * 2) / 3);
    return [text.slice(0, a), text.slice(a, b), text.slice(b)];
  };
  const normalise = (events: SseEvent[]) =>
    events.map((e) => (e.type === 'tool-call-delta' ? { ...e, id: 'ID' } : e));
  const texts: Record<string, string> = {
    plain: 'Here is the news you asked for, in two short lines.\nNothing else today.',
    'one call': `Saving that now.\n${toolCall('saveFact', { statement: 'I live in Pune' })}`,
    'think, text, two calls': `<think>work out what to save</think>Okay.\n${toolCall('saveFact', { statement: 'one' })}\n${toolCall('saveFact', { statement: 'two' })}`,
  };

  it.each(Object.keys(texts))('%s gives the same events on both legs', async (name) => {
    const chunks = split(texts[name]);
    const request = { route: 'topics' as const, messages: MESSAGES, tools: [tool('saveFact')] };

    testHost.llmTransport = undefined;
    server.use(...mockGateway(() => ({ chunks })));
    const viaGateway = await collect(cloudChatStream(request));

    // The gateway mock answers every chat path, so drop it before the local server is called.
    server.resetHandlers();
    allowLocalServer();
    const { baseUrl } = await listen((_req, res) => send(res, chunks));
    use(baseUrl);
    const viaOpenAi = await collect(cloudChatStream(request));

    expect(normalise(viaOpenAi)).toEqual(normalise(viaGateway));
    expect(viaOpenAi.length).toBeGreaterThan(1);
  });
});

describe('the OpenAI chat request', () => {
  it('carries the text-tool messages and no tools field', async () => {
    const { seen, baseUrl } = await listen((_req, res) => send(res, ['ok']));
    use(baseUrl);
    const messages = [
      ...MESSAGES,
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'saveFact', arguments: '{"statement":"a"}' } }],
      },
      { role: 'tool' as const, tool_call_id: 'call_1', content: '{"saved":"a"}' },
    ];
    const tools = [tool('saveFact')];
    await collect(cloudChatStream({ route: 'topics', messages, tools, toolChoice: 'auto', temperature: 0.2, maxTokens: 50, topP: 0.9 }));
    const body = seen[0].body;
    for (const key of ['tools', 'tool_choice', 'functions', 'function_call']) expect(body).not.toHaveProperty(key);
    expect(body.messages).toEqual(JSON.parse(JSON.stringify(toTextToolMessages(messages, tools, 'auto', APP_TOOL_FORMAT))));
    expect(body).toMatchObject({ model: 'm1', stream: true, temperature: 0.2, max_tokens: 50, top_p: 0.9 });
    expect(body).not.toHaveProperty('__enableThinking');
  });

  it('applies a harness quirk the way send does', async () => {
    HARNESS_FILES['thinking-off-chat-test'] = { extends: 'cloud-base', params: { quirks: ['thinking-off-kwarg'] } };
    try {
      const { seen, baseUrl } = await listen((_req, res) => send(res, ['ok']));
      use(baseUrl, { harnessFolder: 'thinking-off-chat-test' });
      await collect(chat());
      await collect(chat({ enableThinking: true }));
      expect(seen[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(seen[1].body.chat_template_kwargs).toEqual({ enable_thinking: true });
      expect(seen.every((s) => !('__enableThinking' in s.body))).toBe(true);
    } finally {
      delete HARNESS_FILES['thinking-off-chat-test'];
    }
  });
});

describe('the no-sampling quirk on the chat leg', () => {
  it('drops temperature and top_p and keeps the rest', async () => {
    const { seen, baseUrl } = await listen((_req, res) => send(res, ['ok']));
    use(baseUrl, { quirks: ['no-sampling'] });
    await collect(chat({ temperature: 0.2, topP: 0.9, maxTokens: 50 }));
    expect(seen[0].body).not.toHaveProperty('temperature');
    expect(seen[0].body).not.toHaveProperty('top_p');
    expect(seen[0].body).toMatchObject({ model: 'm1', stream: true, max_tokens: 50 });
  });
});

describe('OpenAI chat errors', () => {
  it('throws on 401 with its status and one request only', async () => {
    const { seen, baseUrl } = await listen((_req, res) => {
      res.writeHead(401).end('no');
    });
    use(baseUrl);
    const err = await errorOf(collect(chat()));
    expect(err?.message).toBe('model request failed: 401');
    expect((err as { statusCode?: number }).statusCode).toBe(401);
    expect(seen).toHaveLength(1);
  });

  it('retries a 503 and then succeeds', async () => {
    let n = 0;
    const { seen, baseUrl } = await listen((_req, res) => {
      if (++n === 1) return void res.writeHead(503).end('busy');
      send(res, ['fine']);
    });
    use(baseUrl);
    const events = await collect(chat());
    expect(events[0]).toEqual({ type: 'text-delta', delta: 'fine' });
    expect(seen).toHaveLength(2);
  });

  it('ends with a caller abort mid-stream and the server sees the close', async () => {
    const { baseUrl } = await listen((_req, res) => {
      sse(res);
      res.write(delta({ content: 'first' }));
    });
    use(baseUrl);
    const controller = new AbortController();
    const gen = chat({ signal: controller.signal });
    expect((await gen.next()).value).toEqual({ type: 'text-delta', delta: 'first' });
    controller.abort();
    const err = await errorOf(gen.next());
    expect(err).toBeInstanceOf(CallerAbortError);
    for (let i = 0; i < 100 && closes.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(closes).toHaveLength(1);
  });

  it('yields the idle error when the stream stalls', async () => {
    const { baseUrl } = await listen((_req, res) => {
      sse(res);
      res.write(delta({ content: 'start' }));
    });
    use(baseUrl);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'Date', 'performance', 'queueMicrotask', 'hrtime'] });
    const gen = chat();
    expect((await gen.next()).value).toEqual({ type: 'text-delta', delta: 'start' });
    const next = gen.next();
    await new Promise((r) => setImmediate(r));
    jest.advanceTimersByTime(STREAM_IDLE_TIMEOUT_MS);
    expect((await next).value).toEqual({ type: 'error', message: 'the model stopped sending' });
    expect((await gen.next()).done).toBe(true);
  });
  it('times out when the first byte never comes, within callTimeoutMs', async () => {
    const { baseUrl } = await listen(() => undefined);
    use(baseUrl, { callTimeoutMs: 300 });
    const err = await errorOf(collect(chat()));
    expect((err as { name?: string }).name).toBe('TimeoutError');
  });

  it('turns a native tool call in a JSON reply into an error', async () => {
    const { baseUrl } = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'f', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }));
    });
    use(baseUrl);
    expect(await collect(chat({ stream: false }))).toEqual([{ type: 'error', message: 'unexpected native tool call' }]);
  });

  it('refuses a redirect on the chat leg and on a buffered call, so the key never leaves for another address', async () => {
    const target = await listen((_req, res) => send(res, ['moved']));
    const { baseUrl } = await listen((_req, res) => {
      res.writeHead(307, { location: `${target.baseUrl}/chat/completions` }).end();
    });
    use(baseUrl);
    expect(await errorOf(collect(chat()))).toBeTruthy();
    expect(await errorOf(cloudComplete({ systemPrompt: 's', prompt: 'p' }))).toBeTruthy();
    expect(target.seen).toHaveLength(0);
  });

  it('asks once and never retries when the endpoint redirects, on the chat leg and on a buffered call', async () => {
    const target = await listen((_req, res) => send(res, ['moved']));
    const redirecting = await listen((_req, res) => {
      res.writeHead(302, { location: `${target.baseUrl}/chat/completions` }).end();
    });
    use(redirecting.baseUrl);
    expect(await errorOf(collect(chat()))).toBeTruthy();
    expect(redirecting.seen).toHaveLength(1);
    expect(await errorOf(cloudComplete({ systemPrompt: 's', prompt: 'p' }))).toBeTruthy();
    expect(redirecting.seen).toHaveLength(2);
    expect(target.seen).toHaveLength(0);
  });

  it('asks a harness that cannot think for no thinking and no headroom', async () => {
    HARNESS_FILES['no-thinking-chat-test'] = { extends: 'cloud-base', params: { thinking: false, quirks: ['thinking-off-kwarg'] } };
    try {
      const { seen, baseUrl } = await listen((_req, res) => send(res, ['ok']));
      use(baseUrl, { harnessFolder: 'no-thinking-chat-test' });
      await collect(chat({ enableThinking: true, maxTokens: 100 }));
      expect(seen[0].body.chat_template_kwargs).toEqual({ enable_thinking: false });
      expect(seen[0].body.max_tokens).toBe(100);
    } finally {
      delete HARNESS_FILES['no-thinking-chat-test'];
    }
  });
});
