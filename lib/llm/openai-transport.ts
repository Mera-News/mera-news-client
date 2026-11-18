// A plain OpenAI-compatible model transport: one POST to `<baseUrl>/chat/completions` per call,
// with a per-attempt deadline and a short retry on 429, 5xx and network errors. Unlike the gateway
// transport it applies the harness quirks. Its chat leg streams the reply and sends tools as text.

import { fetch } from '@/lib/platform/fetch';
import { harnessFolderFor, loadHarness } from '@/lib/harnesses';
import { QUIRKS } from '@/lib/harnesses/quirks';
import { stripLeakedReasoning } from '../algorithms/reasoning-leak';
import type { BatchCompletionResult } from '@/lib/news-harness/core/types';
import type { BatchCall } from './types';
import { APP_TOOL_FORMAT, toTextToolMessages, type TextToolDefinition } from '@/lib/harnesses/text-tool-protocol';
import { sseEvents } from '../algorithms/sse';
import { CHAT_REASONING_HEADROOM_TOKENS } from './constants';
import { postProcessChatEvents, STREAM_IDLE_TIMEOUT_MS, type SseEvent } from './chat-response';
import type { CloudChatStreamRequest, CloudCompleteRequest, LlmTransport } from './cloudComplete';
import { CallerAbortError, EmptyReplyError, type CloudCallOptions } from './gateway-fetch';
import { assertCloudAllowed } from './on-device-gate';

export interface OpenAiTransportConfig {
  /** The API root that holds `/chat/completions`, such as `http://127.0.0.1:11434/v1`. */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Most requests open at once in a batch. Default 4. */
  concurrency?: number;
  /** Deadline for one attempt, body included. Default 120000. */
  callTimeoutMs?: number;
  /** Harness folder whose quirks apply. Default: the one mapped to the model, else cloud-base. */
  harnessFolder?: string;
}

export type OpenAiTransport = LlmTransport & { inFlight(): number };

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 2000];

const callerAborted = () => new CallerAbortError('openai transport: caller aborted');

/** Waits `ms`, or ends at once with a caller abort, so a stop never waits out a backoff. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(callerAborted());
    const stop = () => {
      clearTimeout(timer);
      reject(callerAborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

const isRetryableStatus = (status: number) => status === 429 || (status >= 500 && status < 600);

/** The wait before the next attempt: Retry-After (seconds or an HTTP date) when sent, else the backoff step. */
function retryDelayMs(response: Response | null, attempt: number): number {
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
}

interface ChatChunk {
  choices?: {
    delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: unknown[] };
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: unknown[];
    };
    finish_reason?: string | null;
  }[];
}

const finishReasonOf = (raw: string | null | undefined): 'stop' | 'tool_calls' | 'length' | 'error' =>
  raw === 'stop' || raw === 'length' || raw === 'tool_calls' ? raw : raw ? 'error' : 'stop';

export function createOpenAiTransport(config: OpenAiTransportConfig): OpenAiTransport {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const timeoutMs = config.callTimeoutMs ?? 120_000;
  const concurrency = config.concurrency ?? 4;
  const params = loadHarness(config.harnessFolder ?? harnessFolderFor('openai', config.model) ?? 'cloud-base').params;
  const quirks = params.quirks;
  for (const name of quirks) if (!QUIRKS[name]) throw new Error(`unknown quirk "${name}" in the harness`);
  let open = 0;

  /** One HTTP attempt: the status and the whole body, under one deadline. */
  async function attempt(body: string, signal?: AbortSignal): Promise<{ response: Response; text: string }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    open++;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      // A redirect would carry the key to an address the config never named. Not followed: it comes
      // back as a 3xx (or an opaque redirect), a status that is never retried.
      const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'manual' });
      return { response, text: await response.text() };
    } catch (err) {
      if (signal?.aborted) throw new CallerAbortError('openai transport: caller aborted', err);
      if (timedOut) {
        throw Object.assign(new Error('the model took longer than the call timeout'), { name: 'TimeoutError' });
      }
      throw err;
    } finally {
      open--;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  async function send(call: Pick<BatchCall, 'system' | 'prompt' | 'temperature' | 'maxTokens' | 'enableThinking'>, signal?: AbortSignal): Promise<string> {
    let body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: 'system', content: call.system },
        { role: 'user', content: call.prompt },
      ],
      stream: false,
      temperature: call.temperature,
      max_tokens: call.maxTokens,
      __enableThinking: call.enableThinking,
    };
    for (const name of quirks) body = QUIRKS[name](body);
    delete body.__enableThinking;
    const payload = JSON.stringify(body); // JSON drops the undefined fields

    for (let n = 0; ; n++) {
      if (signal?.aborted) throw callerAborted();
      let result: { response: Response; text: string } | null = null;
      try {
        result = await attempt(payload, signal);
      } catch (err) {
        const name = (err as { name?: string }).name;
        // Only a thrown fetch is a network error; a deadline or a caller abort ends the call.
        if (name === 'TimeoutError' || err instanceof CallerAbortError || n === MAX_ATTEMPTS - 1) throw err;
        await sleep(retryDelayMs(null, n), signal);
        continue;
      }
      const { response, text } = result;
      if (response.ok) return readReply(text);
      if (isRetryableStatus(response.status) && n < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(response, n), signal);
        continue;
      }
      throw Object.assign(new Error(`model request failed: ${response.status}`), { statusCode: response.status, responseBody: text });
    }
  }

  function readReply(text: string): string {
    if (!text.trim()) throw new EmptyReplyError();
    const message = (JSON.parse(text) as ChatCompletionResponse).choices?.[0]?.message;
    const content = message?.content ?? '';
    if (!content && message?.reasoning_content) throw new Error('[OpenAiTransport] reasoning-overran-budget');
    return stripLeakedReasoning(content).trim();
  }

  async function complete(request: CloudCompleteRequest, options: CloudCallOptions): Promise<string> {
    await assertCloudAllowed(request.purpose);
    return send(
      {
        system: request.systemPrompt,
        prompt: request.prompt,
        temperature: request.temperature ?? 0.3,
        maxTokens: request.maxTokens ?? request.maxCompletionTokens,
        enableThinking: false,
      },
      options.signal,
    );
  }

  async function batch(calls: BatchCall[], _route: unknown, options: CloudCallOptions): Promise<BatchCompletionResult[]> {
    await assertCloudAllowed();
    const results: BatchCompletionResult[] = new Array(calls.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < calls.length; i = next++) {
        try {
          results[i] = { id: calls[i].id, output: await send(calls[i], options.signal) };
        } catch (err) {
          results[i] = { id: calls[i].id, output: '', error: err instanceof Error ? err.message : String(err) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, calls.length) }, worker));
    return results;
  }

  /** The raw leg: events as the model wrote them, before think stripping and tool parsing. */
  async function* rawChat(request: CloudChatStreamRequest): AsyncGenerator<SseEvent> {
    const { signal } = request;
    // A harness that cannot think is never asked to, as on the gateway leg.
    const thinking = (request.enableThinking ?? false) && params.thinking;
    let body: Record<string, unknown> = {
      model: config.model,
      messages: toTextToolMessages(request.messages, request.tools as TextToolDefinition[] | undefined, request.toolChoice, APP_TOOL_FORMAT),
      stream: request.stream !== false,
      temperature: request.temperature,
      // The trace shares the answer's token budget, so a thinking call gets headroom for it.
      max_tokens: request.maxTokens === undefined ? undefined : request.maxTokens + (thinking ? CHAT_REASONING_HEADROOM_TOKENS : 0),
      max_completion_tokens: request.maxCompletionTokens,
      top_p: request.topP,
      n: request.n,
      presence_penalty: request.presencePenalty,
      frequency_penalty: request.frequencyPenalty,
      __enableThinking: thinking,
    };
    for (const name of quirks) body = QUIRKS[name](body);
    delete body.__enableThinking;
    const payload = JSON.stringify(body);

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sawBytes = false;
    let timedOut = false;
    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, ms);
    };
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    open++;
    try {
      let response: Response | null = null;
      for (let n = 0; !response; n++) {
        if (signal?.aborted) throw callerAborted();
        arm(timeoutMs);
        try {
          const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
          if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
          const res = await fetch(url, { method: 'POST', headers, body: payload, signal: controller.signal, redirect: 'manual' });
          if (res.ok) {
            response = res;
            break;
          }
          const text = await res.text();
          if (isRetryableStatus(res.status) && n < MAX_ATTEMPTS - 1) {
            clearTimeout(timer);
            await sleep(retryDelayMs(res, n), signal);
            continue;
          }
          throw Object.assign(new Error(`model request failed: ${res.status}`), { statusCode: res.status, responseBody: text });
        } catch (err) {
          if (signal?.aborted) throw new CallerAbortError('openai transport: caller aborted', err);
          if (timedOut) throw Object.assign(new Error('the model took longer than the call timeout'), { name: 'TimeoutError' });
          if ((err as { statusCode?: number }).statusCode !== undefined || err instanceof CallerAbortError || n === MAX_ATTEMPTS - 1) throw err;
          await sleep(retryDelayMs(null, n), signal);
        }
      }

      // Content type first: reading `.body` on a JSON reply would empty what text() reads.
      if (!(response.headers.get('content-type') ?? '').includes('text/event-stream') || !response.body) {
        let text: string;
        try {
          text = await response.text();
        } catch (err) {
          if (signal?.aborted) throw new CallerAbortError('openai transport: caller aborted', err);
          if (timedOut) throw Object.assign(new Error('the model took longer than the call timeout'), { name: 'TimeoutError' });
          throw err;
        }
        clearTimeout(timer);
        if (!text.trim()) throw new EmptyReplyError();
        const choice = (JSON.parse(text) as ChatChunk).choices?.[0];
        const message = choice?.message;
        if (message?.tool_calls?.length) return void (yield { type: 'error', message: 'unexpected native tool call' });
        if (!message?.content && (message?.reasoning_content || message?.reasoning)) yield { type: 'reasoning' };
        if (message?.content) yield { type: 'text-delta', delta: message.content };
        yield { type: 'finish', reason: finishReasonOf(choice?.finish_reason) };
        return;
      }

      const reader = response.body.getReader();
      let finish = 'stop';
      let reasoned = false;
      let started = false;
      try {
        for await (const data of sseEvents(reader, () => {
          sawBytes = true;
          arm(STREAM_IDLE_TIMEOUT_MS);
        })) {
          if (data === '[DONE]') break;
          let chunk: ChatChunk;
          try {
            chunk = JSON.parse(data) as ChatChunk;
          } catch {
            continue;
          }
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finish = choice.finish_reason;
          const d = choice.delta;
          if (!d) continue;
          if (d.tool_calls?.length) return void (yield { type: 'error', message: 'unexpected native tool call' });
          if ((d.reasoning_content || d.reasoning) && !started && !reasoned) {
            reasoned = true;
            yield { type: 'reasoning' };
          }
          if (d.content) {
            started = true;
            yield { type: 'text-delta', delta: d.content };
          }
        }
      } catch (err) {
        if (signal?.aborted) throw new CallerAbortError('openai transport: caller aborted', err);
        if (!timedOut) throw err;
        if (!sawBytes) throw Object.assign(new Error('the model took longer than the call timeout'), { name: 'TimeoutError' });
        return void (yield { type: 'error', message: 'the model stopped sending' });
      } finally {
        void reader.cancel().catch(() => undefined);
      }
      if (signal?.aborted) throw callerAborted();
      yield { type: 'finish', reason: finishReasonOf(finish) };
    } finally {
      open--;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  async function* chat(request: CloudChatStreamRequest): AsyncGenerator<SseEvent> {
    await assertCloudAllowed('chat');
    yield* postProcessChatEvents(rawChat(request), (request.tools ?? []) as TextToolDefinition[]);
  }

  return {
    asyncJobs: false,
    complete,
    batch,
    chat,
    inFlight: () => open,
  };
}
