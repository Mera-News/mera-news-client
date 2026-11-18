"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createOpenAiTransport = createOpenAiTransport;
var _fetch = require("../platform/fetch");
var _harnesses = require("../harnesses");
var _quirks = require("../harnesses/quirks");
var _reasoningLeak = require("../algorithms/reasoning-leak");
var _gatewayFetch = require("./gateway-fetch");
var _onDeviceGate = require("./on-device-gate");
// A plain OpenAI-compatible model transport: one POST to `<baseUrl>/chat/completions` per call,
// with a per-attempt deadline and a short retry on 429, 5xx and network errors. Unlike the gateway
// transport it applies the harness quirks, and it has no chat leg.

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 2000];
const callerAborted = () => new _gatewayFetch.CallerAbortError('openai transport: caller aborted');

/** Waits `ms`, or ends at once with a caller abort, so a stop never waits out a backoff. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(callerAborted());
    const stop = () => {
      clearTimeout(timer);
      reject(callerAborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, {
      once: true
    });
  });
}
const isRetryableStatus = status => status === 429 || status >= 500 && status < 600;

/** The wait before the next attempt: Retry-After (seconds or an HTTP date) when sent, else the backoff step. */
function retryDelayMs(response, attempt) {
  const header = response?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}
function createOpenAiTransport(config) {
  const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const timeoutMs = config.callTimeoutMs ?? 120_000;
  const concurrency = config.concurrency ?? 4;
  const quirks = (0, _harnesses.loadHarness)(config.harnessFolder ?? (0, _harnesses.harnessFolderFor)('openai', config.model) ?? 'cloud-base').params.quirks;
  for (const name of quirks) if (!_quirks.QUIRKS[name]) throw new Error(`unknown quirk "${name}" in the harness`);
  let open = 0;

  /** One HTTP attempt: the status and the whole body, under one deadline. */
  async function attempt(body, signal) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener('abort', onCallerAbort, {
      once: true
    });
    open++;
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
      const response = await (0, _fetch.fetch)(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal
      });
      return {
        response,
        text: await response.text()
      };
    } catch (err) {
      if (signal?.aborted) throw new _gatewayFetch.CallerAbortError('openai transport: caller aborted', err);
      if (timedOut) {
        throw Object.assign(new Error('the model took longer than the call timeout'), {
          name: 'TimeoutError'
        });
      }
      throw err;
    } finally {
      open--;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }
  async function send(call, signal) {
    let body = {
      model: config.model,
      messages: [{
        role: 'system',
        content: call.system
      }, {
        role: 'user',
        content: call.prompt
      }],
      stream: false,
      temperature: call.temperature,
      max_tokens: call.maxTokens,
      __enableThinking: call.enableThinking
    };
    for (const name of quirks) body = _quirks.QUIRKS[name](body);
    delete body.__enableThinking;
    const payload = JSON.stringify(body); // JSON drops the undefined fields

    for (let n = 0;; n++) {
      if (signal?.aborted) throw callerAborted();
      let result = null;
      try {
        result = await attempt(payload, signal);
      } catch (err) {
        const name = err.name;
        // Only a thrown fetch is a network error; a deadline or a caller abort ends the call.
        if (name === 'TimeoutError' || err instanceof _gatewayFetch.CallerAbortError || n === MAX_ATTEMPTS - 1) throw err;
        await sleep(retryDelayMs(null, n), signal);
        continue;
      }
      const {
        response,
        text
      } = result;
      if (response.ok) return readReply(text);
      if (isRetryableStatus(response.status) && n < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs(response, n), signal);
        continue;
      }
      throw Object.assign(new Error(`model request failed: ${response.status}`), {
        statusCode: response.status,
        responseBody: text
      });
    }
  }
  function readReply(text) {
    if (!text.trim()) throw new _gatewayFetch.EmptyReplyError();
    const message = JSON.parse(text).choices?.[0]?.message;
    const content = message?.content ?? '';
    if (!content && message?.reasoning_content) throw new Error('[OpenAiTransport] reasoning-overran-budget');
    return (0, _reasoningLeak.stripLeakedReasoning)(content).trim();
  }
  async function complete(request, options) {
    await (0, _onDeviceGate.assertCloudAllowed)(request.purpose);
    return send({
      system: request.systemPrompt,
      prompt: request.prompt,
      temperature: request.temperature ?? 0.3,
      maxTokens: request.maxTokens ?? request.maxCompletionTokens,
      enableThinking: false
    }, options.signal);
  }
  async function batch(calls, _route, options) {
    await (0, _onDeviceGate.assertCloudAllowed)();
    const results = new Array(calls.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < calls.length; i = next++) {
        try {
          results[i] = {
            id: calls[i].id,
            output: await send(calls[i], options.signal)
          };
        } catch (err) {
          results[i] = {
            id: calls[i].id,
            output: '',
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }
    };
    await Promise.all(Array.from({
      length: Math.min(concurrency, calls.length)
    }, worker));
    return results;
  }
  return {
    asyncJobs: false,
    complete,
    batch,
    // shortcut: no pod path chats yet, build a buffered leg when one does
    async *chat() {
      throw new Error('chat is not available on this transport');
    },
    inFlight: () => open
  };
}