"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.STREAM_IDLE_TIMEOUT_MS = void 0;
exports.consumeChatResponse = consumeChatResponse;
var _e2eeService = require("../e2ee/e2ee-service");
var _logger = _interopRequireDefault(require("../logger"));
var _thinkStrip = require("../algorithms/think-strip");
var _textToolProtocol = require("../harnesses/text-tool-protocol");
var _sse = require("../algorithms/sse");
var _chatTurn = require("./chat-turn");
var _gatewayFetch = require("./gateway-fetch");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// chat-response — turns an OK gateway chat response into SseEvents: SSE
// streaming (one E2EE envelope per delta) or the buffered JSON fallback, with
// think-stripping and text-tool-call parsing applied once for every consumer.
// Imports gateway-fetch only.

const TAG = '[CloudLLM]';

/** Max gap BETWEEN CHUNKS of an in-flight SSE body — deliberately not the time
 *  to the FIRST chunk, which stays on {@link UPSTREAM_ALIGNED_TIMEOUT_MS}.
 *
 *  Whether NEAR flushes SSE headers on accept or only with the first token is
 *  unverified (the gateway relays whatever it gets). If headers land on accept,
 *  a single 30s window measured from headers would abort a cold model that the
 *  old buffered path tolerated for 130s — a regression on exactly the path this
 *  is meant to speed up. Two windows make the constant mean what it says under
 *  either upstream behavior. */
const STREAM_IDLE_TIMEOUT_MS = exports.STREAM_IDLE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// SSE event types (OpenAI chat completion chunk format)
// ---------------------------------------------------------------------------

/** Non-streaming chat completion response (used for E2EE path). */

/** One OpenAI streaming chunk. `choices` is optional AND may be empty — the
 *  final usage-only chunk carries `choices: []`. */
/** What opens a reply: the client key, its curve, and (RedPill v2) the AAD parameters. */

/** Turn an OK chat response into events, streaming when the gateway relayed
 *  SSE and buffering when it relayed JSON.
 *
 *  Think tags are stripped HERE, once, for every cloud chat consumer (the
 *  persona loop, single-shot and article chat): a reply rendered
 *  "... Bhopal. </think>". A tag split across deltas is held until it resolves,
 *  and an all-reasoning delta yields nothing rather than an empty delta.
 *
 *  Tool calls are parsed HERE too, after the think stripper (a call inside a
 *  think block must never run): they arrive as text inside the encrypted
 *  content (text-tool-protocol) and leave as the same `tool-call-delta` events
 *  a native call used to produce, one whole call per event.
 *
 *  A null `response` reads the reply from the turn store from byte 0: the
 *  attempt was cut off before any headers. */
async function* consumeChatResponse(response, key, tools, signal, resume) {
  const think = (0, _thinkStrip.createThinkStripper)();
  const calls = (0, _textToolProtocol.createToolCallStreamParser)(tools, _textToolProtocol.APP_TOOL_FORMAT);
  let callIndex = 0;
  const stamp = Date.now().toString(36);
  function* emit(r) {
    if (r.text) yield {
      type: 'text-delta',
      delta: r.text
    };
    for (const c of r.calls) {
      const index = callIndex++;
      yield {
        type: 'tool-call-delta',
        index,
        id: `call_${stamp}_${index}`,
        name: c.name,
        argumentsDelta: c.argumentsRaw
      };
    }
  }
  for await (const event of consumeChatResponseRaw(response, key, signal, resume)) {
    if (event.type === 'text-delta') {
      const delta = think.push(event.delta);
      if (delta) yield* emit(calls.push(delta));
      continue;
    }
    if (event.type === 'tool-call-delta') {
      // A provider that lifted a call out of the content sent it in CLEAR: it
      // never passed the envelope, so nothing proves the model wrote it. Report
      // it once (never its content) and fail the turn closed; nothing is
      // forwarded, so nothing runs.
      _logger.default.captureMessage(`${TAG} provider returned a cleartext tool call`, {
        level: 'error',
        fingerprint: ['e2ee-cleartext-tool-call'],
        tags: {
          component: 'cloudComplete'
        }
      });
      throw new _gatewayFetch.CleartextToolCallError();
    }
    if (event.type === 'finish') {
      const tail = think.flush();
      if (tail) yield* emit(calls.push(tail));
      const last = calls.flush();
      yield* emit(last);
      if (callIndex > 0 && event.reason === 'stop') {
        yield {
          type: 'finish',
          reason: 'tool_calls'
        };
        continue;
      }
    }
    yield event;
  }
}
async function* consumeChatResponseRaw(response, key, signal, resume) {
  if (!response) {
    // shortcut: a streamed leg whose upstream ignored `stream: true` stored JSON and reads as
    // empty here, upgrade if a resumed turn ever comes back blank.
    if (resume?.streamed) yield* consumeSseChat(null, key, undefined, signal, resume);else yield* parseBufferedChat(await (0, _chatTurn.readStoredTurn)(resume, signal), key);
    return;
  }
  const handle = (0, _gatewayFetch.takeStreamHandle)(response);
  const contentType = response.headers?.get('content-type') ?? '';
  // Content-type first: reading expo/fetch's `.body` starts native streaming and empties the
  // buffer text() reads (MERA-APP-8X).
  if (!contentType.includes('text/event-stream') || !response.body) {
    // The gateway relays NEAR's content-type verbatim, so JSON here means the
    // upstream ignored `stream: true`. Buffered handling, unchanged.
    handle?.release();
    yield* consumeBufferedChat(response, key, signal, resume);
    return;
  }
  yield* consumeSseChat(response, key, handle, signal, resume);
}

/** Streaming path: one E2EE envelope per `delta.content`, decrypted as it lands. */
/** The provider's finish_reason as the client reports it. `length` is kept so a
 *  caller can tell a token-capped answer from a finished one; anything else
 *  the client does not act on is a plain stop. */
function finishReasonOf(raw) {
  return raw === 'tool_calls' || raw === 'length' ? raw : 'stop';
}
async function* consumeSseChat(response, key, handle, signal, resume) {
  const socket = response?.body?.getReader() ?? null;
  // The resume happens BELOW the parser, as more bytes of the same stream, so
  // parser, think and tool state carry over and no text can arrive twice.
  const turn = resume ? (0, _chatTurn.turnReader)(socket, resume, handle, signal) : null;
  const reader = turn ?? socket;
  let idleTimer;
  let idleTimedOut = false;
  const armIdle = ms => {
    clearTimeout(idleTimer);
    // A poll has its own stall budget, which does not count time away.
    if (turn?.polling()) return;
    idleTimer = setTimeout(() => {
      if (turn?.takeOver()) return;
      idleTimedOut = true;
      // Abort the in-flight body so the pending read rejects instead of
      // hanging forever behind a silent upstream.
      handle?.abort();
      void reader.cancel().catch(() => {/* already dead */});
    }, ms);
  };

  // A stop cancels the body at once instead of waiting for the next chunk.
  const onStop = () => {
    handle?.abort();
    void reader.cancel().catch(() => {/* already dead */});
  };
  if (signal?.aborted) onStop();else signal?.addEventListener('abort', onStop, {
    once: true
  });
  let finishReason = 'stop';
  try {
    // authFetch dropped its own 130s header timer at handoff; until the first
    // chunk arrives this reinstates the same budget (a cold model may sit on an
    // open, silent stream). Every chunk after that tightens it.
    armIdle(_gatewayFetch.UPSTREAM_ALIGNED_TIMEOUT_MS);
    let reasoningSignalled = false;
    for await (const payload of (0, _sse.sseEvents)(reader, () => armIdle(STREAM_IDLE_TIMEOUT_MS))) {
      if (payload === '[DONE]') break;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        _logger.default.debug(`${TAG} unparseable SSE payload (skipped)`, {
          length: payload.length
        });
        continue;
      }
      // The trailing usage chunk carries `choices: []`.
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta;
      if (!delta) continue;

      // `delta.reasoning_content` is chain-of-thought. It arrives as its own
      // field and may itself be an encrypted envelope; it is dropped WITHOUT
      // decrypting, and must never be yielded as assistant text. Its ARRIVAL
      // is signalled once, so the bubble can show "Thinking…" — on the BIG
      // primary the trace runs 3-12s before the first visible token.
      if (delta.reasoning_content && !reasoningSignalled) {
        reasoningSignalled = true;
        yield {
          type: 'reasoning'
        };
      }
      if (delta.content) {
        const field = `choices.${choice.index ?? 0}.delta.content`;
        yield {
          type: 'text-delta',
          delta: (0, _e2eeService.openField)(delta.content, key, field, chunk.id ?? '')
        };
      }

      // The app never sends a tools field, so a native `delta.tool_calls` here
      // means the provider lifted a call out of the content, in CLEAR.
      // consumeChatResponse reports it and fails the turn closed.
      for (const tc of delta.tool_calls ?? []) {
        yield {
          type: 'tool-call-delta',
          index: tc.index ?? 0,
          id: tc.id,
          name: tc.function?.name,
          argumentsDelta: tc.function?.arguments ?? ''
        };
      }
    }
    // A cancelled reader ends the loop cleanly, so the flag is the only signal.
    if (signal?.aborted) throw new _gatewayFetch.CallerAbortError('cloudChatStream: stopped');
    if (idleTimedOut) throw new _gatewayFetch.StreamIdleError();
  } catch (err) {
    // The cancelled body rejects with a plain abort error: re-type it, so it is
    // never read as evidence about the model.
    if (signal?.aborted && !(0, _gatewayFetch.isCallerAbort)(err)) throw new _gatewayFetch.CallerAbortError('cloudChatStream: stopped', err);
    throw err;
  } finally {
    clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onStop);
    handle?.release();
  }
  yield {
    type: 'finish',
    reason: finishReasonOf(finishReason)
  };
}

/** Buffered path: a whole non-streaming completion, one envelope for the whole
 *  answer. Reached when the upstream ignores `stream: true`. */
async function* consumeBufferedChat(response, key, signal, resume) {
  let raw;
  try {
    raw = await response.text();
  } catch (err) {
    if (!resume?.left() || signal?.aborted) throw err;
    raw = await (0, _chatTurn.readStoredTurn)(resume, signal);
  }
  yield* parseBufferedChat(raw, key);
}
async function* parseBufferedChat(raw, key) {
  if (!raw.trim()) throw new _gatewayFetch.EmptyReplyError();
  const data = JSON.parse(raw);
  const choice = data.choices?.[0];
  if (!choice) {
    yield {
      type: 'finish',
      reason: 'stop'
    };
    return;
  }

  // Decrypt content if present
  if (choice.message?.content) {
    const rawContent = choice.message.content;
    _logger.default.debug(`${TAG} E2EE response content`, {
      contentLen: rawContent.length,
      responseId: data.id,
      model: data.model,
      finishReason: choice.finish_reason,
      hasReasoning: !!choice.message.reasoning_content
    });
    const decrypted = (0, _e2eeService.openField)(rawContent, key, 'choices.0.message.content', data.id ?? '');
    yield {
      type: 'text-delta',
      delta: decrypted
    };
  }

  // Never expected: the app sends no tools field (see consumeSseChat).
  if (choice.message?.tool_calls) {
    for (const [index, tc] of choice.message.tool_calls.entries()) {
      yield {
        type: 'tool-call-delta',
        index,
        id: tc.id,
        name: tc.function.name,
        argumentsDelta: tc.function.arguments
      };
    }
  }
  yield {
    type: 'finish',
    reason: finishReasonOf(choice.finish_reason)
  };
}