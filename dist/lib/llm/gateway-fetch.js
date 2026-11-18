"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.UPSTREAM_ALIGNED_TIMEOUT_MS = exports.StreamIdleError = exports.RateLimitedError = exports.MAX_ATTEMPTS = exports.EmptyReplyError = exports.CleartextToolCallError = exports.CallerAbortError = exports.AppLeftError = void 0;
exports.authFetch = authFetch;
exports.cancelTurn = cancelTurn;
exports.getAuthHeaders = getAuthHeaders;
exports.isAbortLike = isAbortLike;
exports.isCallerAbort = isCallerAbort;
exports.newChatTurn = void 0;
exports.retryAfterMsFrom = retryAfterMsFrom;
exports.takeStreamHandle = takeStreamHandle;
exports.turnUrl = void 0;
var _fetch = require("../platform/fetch");
var _utils = require("@noble/ciphers/utils.js");
var _appRestart = require("../app-restart");
var _e2eeCrypto = require("../e2ee/e2ee-crypto");
var _auth = require("../platform/auth");
var _logger = _interopRequireDefault(require("../logger"));
var gatewayRateLimiter = _interopRequireWildcard(require("./gateway-rate-limiter"));
var _retryAfter = require("../algorithms/retry-after");
var _endpoints = require("../config/endpoints");
var _sleep = require("../utils/sleep");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// gateway-fetch — the authenticated transport under every cloud LLM call:
// JWT headers, per-attempt timeout, backoff with jitter, 401 re-mint, 429 and
// 502 handling, and the stream handle a streaming body hands to its reader.
// Imports none of cloudComplete / routed-send / chat-response.

const TAG = '[CloudLLM]';

/** Per-attempt timeout for EVERY gateway-bound cloud call (chat, single
 *  completion, batch). It must exceed the gateway's own UPSTREAM_TIMEOUT_MS
 *  (120s) so the gateway's verdict — a 200, or the 502 it emits when NEAR never
 *  answered — lands before the client aborts. A client that aborts FIRST never
 *  learns anything and just starts a fresh attempt against a model that is
 *  still warming: that is the retry storm this constant exists to kill.
 *  130s = 120s gateway + 10s slack.
 *
 *  COUPLING (mera-inference-gateway fix C.1): `client 130s > gateway 120s` is
 *  only true once the gateway's deadline is stamped at REQUEST ENTRY and so
 *  bounds queue wait + upstream. Today it starts at slot acquisition, which
 *  makes the real gateway budget `queue wait + 120s` — unbounded under
 *  saturation, and the client still aborts first, just at a bigger number.
 *  This 130s assumption lands together with that gateway change; changing one
 *  without the other silently re-opens the storm. */
const UPSTREAM_ALIGNED_TIMEOUT_MS = exports.UPSTREAM_ALIGNED_TIMEOUT_MS = 130_000;

/** Build auth headers, fetching a fresh JWT from the auth service. Throws if
 *  no token is available — sending an unauthenticated request just burns the
 *  401 re-mint (see authFetch) and surfaces as a confusing HTTP error
 *  downstream. Failing fast here gives the caller a clear cause. */
async function getAuthHeaders() {
  const token = await (0, _auth.getJwtToken)();
  if (!token) {
    throw new Error('cloudComplete: no JWT token available');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

/** Total attempts for ANY gateway-bound call, the initial one included.
 *
 *  Was 10 RETRIES with an unjittered `BASE_DELAY_MS * 2 ** attempt`, which put
 *  a default caller on 11 requests and 511.5s of pure sleeping before it gave
 *  up — and on the 60s timeout path, ~19.5 minutes for one logical call. An
 *  outage should cost a handful of attempts, not a loop: past the third retry
 *  the gateway is down, not busy, and every extra attempt is budget spent
 *  against the user's own per-user throttle. */
const MAX_ATTEMPTS = exports.MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 500;

/** Ceiling on the exponential term before jitter is applied. */
const MAX_BACKOFF_MS = 8_000;

/** Longest `Retry-After` we will honour. A gateway asking for more than a
 *  minute is an outage, and the caller is better served by an error it can act
 *  on than by a request held open. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Backoff for a 429 that carries no usable `Retry-After`. Matches
 *  submitInferenceJob and web-search-client, which already back off by this. */
const DEFAULT_THROTTLE_BACKOFF_MS = 30_000;

/**
 * FULL JITTER (AWS "Exponential Backoff and Jitter"): a uniform pick from
 * [0, backoff), not `backoff` itself.
 *
 * The old fixed delay meant every device that saw the same outage retried in
 * the same millisecond, so the gateway got a synchronised wave per retry round
 * — the shape that keeps an overloaded service overloaded. Spreading the
 * attempts is most of the value of capping them.
 */
function backoffWithJitter(attempt) {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/** Parse a `Retry-After` header (integer seconds) into a clamped ms value.
 *  Falls back to {@link DEFAULT_THROTTLE_BACKOFF_MS} when absent or unusable. */
function retryAfterMsFrom(headers) {
  return (0, _retryAfter.retryAfterMs)(headers?.get('Retry-After'), {
    defaultMs: DEFAULT_THROTTLE_BACKOFF_MS,
    maxMs: MAX_RETRY_AFTER_MS
  });
}

/**
 * The gateway throttled this device and the wait is too long to hold a person's
 * turn open.
 *
 * `statusCode` is a FIELD so the app's 401/HTTP-status rule in
 * `logger.captureException` reads it off the error, and so triage can tell a
 * throttle apart from an outage. NOTE: a chat caller cannot yet act on the
 * TYPE — `useCloudPersonaChat` flattens every error to a string before the UI
 * sees it — so a 429 currently reads to the user as a generic inference error.
 */
class RateLimitedError extends Error {
  constructor(retryAfterMs) {
    super(`Gateway rate limited: retry after ${retryAfterMs}ms`);
    this.statusCode = 429;
    this.retryAfterMs = void 0;
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
    // Preserve instanceof across the TS/Babel transpile of `extends Error`.
    Object.setPrototypeOf(this, RateLimitedError.prototype);
  }
}

/** Default per-attempt timeout for cloud requests (scoring/batch). Inference can
 *  take a while on a cold model + large prompt, but anything past this is almost
 *  certainly a hung connection and we'd rather surface the error to the caller. */
exports.RateLimitedError = RateLimitedError;
const REQUEST_TIMEOUT_MS = 60_000;

/** Per-call overrides for {@link authFetch}. Defaults preserve the original
 *  shared behavior for every existing caller (scoring, batch); only the chat
 *  path opts into different values. */

/** One chat attempt's handle on the gateway's turn store. */

const newChatTurn = () => ({
  id: null,
  bytes: 0,
  polled: false,
  cancelled: false
});

/** Base URL of the turn routes. */
exports.newChatTurn = newChatTurn;
const turnUrl = id => `${_endpoints.INFERENCE_ENDPOINT}/v1/chat/turns/${id}`;

/**
 * Best effort: a detached turn keeps running and stays paid after a disconnect,
 * so a turn nobody will read is cancelled by hand. Background lane, because
 * nobody waits on it. Never throws.
 */
exports.turnUrl = turnUrl;
function cancelTurn(turn) {
  if (!turn.id || turn.cancelled) return;
  turn.cancelled = true;
  const url = turnUrl(turn.id);
  void getAuthHeaders().then(headers => authFetch(url, {
    method: 'DELETE',
    headers
  }, {
    maxTimeoutAttempts: 1
  })).catch(() => {/* the turn ends on its own deadline */});
}

/** Per-call options for the cloud entry points. */

/**
 * A caller's own signal aborted the request. Distinct from the per-attempt
 * timeout abort, which is indistinguishable by message alone: both surface as
 * "aborted"/"canceled" from expo/fetch. A caller abort is not evidence about
 * the model and must never consume the timeout budget, retry, or engage the
 * session fallback.
 */
class CallerAbortError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'CallerAbortError';
    if (cause !== undefined) this.cause = cause;
  }
}
exports.CallerAbortError = CallerAbortError;
function isCallerAbort(err) {
  return err instanceof CallerAbortError;
}

/**
 * The SSE stream stalled past its idle window and the reader was cancelled. The
 * cancelled body ends cleanly, so this is the only signal; it is timeout-class
 * evidence about the model exactly like an abort.
 */
class StreamIdleError extends Error {
  constructor() {
    super('[CloudLLM] chat stream went idle');
    this.name = 'StreamIdleError';
  }
}

/** The provider answered 2xx with an empty body: nothing to parse, and model
 *  evidence like a stall (MERA-APP-8Q, twice in a row on the same model). */
exports.StreamIdleError = StreamIdleError;
class EmptyReplyError extends Error {
  constructor() {
    super('[CloudLLM] chat reply was empty');
    this.name = 'EmptyReplyError';
  }
}

/**
 * The provider returned a tool call in CLEAR (`delta.tool_calls` or
 * `message.tool_calls`), outside the E2EE envelope. Nothing proves the model
 * wrote it, so the turn fails closed: never forwarded, never executed, never
 * retried and never model evidence. The message carries no call content.
 */
exports.EmptyReplyError = EmptyReplyError;
class CleartextToolCallError extends Error {
  constructor() {
    super('[CloudLLM] provider returned a cleartext tool call');
    this.name = 'CleartextToolCallError';
  }
}

/**
 * A chat attempt was cut off because the app left. Says nothing about the model,
 * and deliberately not abort-like: the router treats those as evidence. `cloudChatStream` catches it and recovers the leg on return.
 */
exports.CleartextToolCallError = CleartextToolCallError;
class AppLeftError extends Error {
  constructor() {
    super('[CloudLLM] the app left during the attempt');
    this.name = 'AppLeftError';
  }
}

/** Live per-attempt resources of a response whose body is still being read. */
exports.AppLeftError = AppLeftError;
// Keyed by Response so the handle follows whichever leg actually answered,
// with no plumbing through the return shape every non-stream caller uses.
// An abandoned leg's handle is simply never taken: the entry dies with its
// Response, and the listener it would have detached sits on that leg's own
// throwaway controller.
const streamHandles = new WeakMap();

/** Take (and remove) the stream handle attached to a `streamBody` response. */
function takeStreamHandle(response) {
  const handle = streamHandles.get(response);
  if (handle) streamHandles.delete(response);
  return handle;
}

/**
 * Is this error a client-side cancellation (our per-attempt timeout, or a
 * caller abort)? `expo/fetch` words its cancellation "Fetch request has been
 * canceled", which the old `/abort/`-only test missed — so our own 60s timeouts
 * were logged as `timedOut: false` and read as network errors during the
 * 2026-07-31 incident. Matching `cancel` as well makes the log state the truth;
 * the retry budget is unaffected (aborts and network errors already share it).
 */
function isAbortLike(err) {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  const message = err.message.toLowerCase();
  return message.includes('abort') || message.includes('cancel');
}

/**
 * Combine a caller-supplied signal with the per-attempt timeout signal.
 *
 * The previous `init.signal ?? controller.signal` silently DISABLED the timeout
 * for any caller that passed a signal — the request could then hang forever.
 * `AbortSignal.any` is not in React Native's `abort-controller` polyfill, so it
 * is feature-detected and bridged with listeners otherwise. The returned
 * `release` must be called per attempt, or listeners stack up on the caller's
 * (long-lived) signal once per retry.
 */
function combineSignals(external, timeout) {
  const noop = () => {/* nothing to release */};
  if (!external) return {
    signal: timeout,
    release: noop
  };
  const anyFn = AbortSignal.any;
  if (typeof anyFn === 'function') {
    return {
      signal: anyFn.call(AbortSignal, [external, timeout]),
      release: noop
    };
  }
  const combined = new AbortController();
  if (external.aborted || timeout.aborted) combined.abort();
  const onAbort = () => combined.abort();
  external.addEventListener('abort', onAbort);
  timeout.addEventListener('abort', onAbort);
  return {
    signal: combined.signal,
    release: () => {
      external.removeEventListener('abort', onAbort);
      timeout.removeEventListener('abort', onAbort);
    }
  };
}

/**
 * Fetch with exponential backoff and a per-attempt timeout.
 * Retries on 401 (refreshes JWT), 5xx, timeout, and network errors.
 *
 * `options` tunes the timeout + the 502/timeout retry budget per call without
 * changing the shared defaults every other caller relies on.
 */
async function authFetch(url, init, options = {}) {
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxTimeoutAttempts = options.maxTimeoutAttempts ?? MAX_ATTEMPTS;
  const lane = options.lane ?? 'background';
  const lastAttempt = MAX_ATTEMPTS - 1;
  let lastError = null;
  // Counts attempts that ended in a 502 or a client timeout/network abort —
  // i.e. the "upstream is cold / unreachable" family the chat path caps.
  let timeoutAttempts = 0;
  // One re-mint, one throttle retry. Latches rather than budget: a 401 that
  // survives a fresh JWT is a dead session, and three honoured Retry-Afters
  // would hold a call open for minutes.
  let reminted = false;
  let throttleRetried = false;
  for (let attempt = 0; attempt <= lastAttempt; attempt++) {
    // A suspended phone cannot answer: hold here rather than burn the budget.
    if (lane === 'interactive') await (0, _appRestart.whenForeground)(init.signal);
    const left = (0, _appRestart.departureMark)();

    // The ONLY reliable discriminator between a caller abort and our own
    // per-attempt timeout: the caller's original signal. The combined signal is
    // aborted by both. Checked at the loop top so an aborted leg that is mid
    // backoff exits here (sleep() is deliberately not abort-aware — the extra
    // wait is bounded and never turns into another request).
    if (init.signal?.aborted) {
      throw new CallerAbortError('authFetch: caller aborted', lastError);
    }

    // THE GRANT, PER ATTEMPT. A retry is a request: metering only the first
    // attempt would let one logical call spend MAX_ATTEMPTS slots against a
    // one-slot budget. This single seam covers every path above it — the
    // next-profile send, the 401 re-mint, and both of
    // cloudChatStream's re-sends.
    //
    // The caller's own signal is passed in so an abandoned waiter (a cancelled
    // turn, an abandoned leg) is spliced out of the queue instead of holding
    // a position ahead of background callers and burning a grant nobody uses.
    if (!(attempt === 0 && options.grantAlreadyHeld)) {
      try {
        await gatewayRateLimiter.acquire(lane, init.signal ?? undefined);
      } catch (err) {
        // The only rejection acquire() has is the caller's own abort.
        throw new CallerAbortError('authFetch: caller aborted while queued', err);
      }
    }

    // Re-check AFTER the grant wait, which can be long. A caller that went
    // away while queued must not spend a request — and must not reach
    // expoFetch with an already-aborted signal, where the abort has happened
    // before anything is listening for it.
    if (init.signal?.aborted) {
      throw new CallerAbortError('authFetch: caller aborted', lastError);
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
    // A caller signal must ADD to the timeout, never replace it.
    const {
      signal,
      release
    } = combineSignals(init.signal, controller.signal);
    // Set when the attempt's teardown is handed to the caller (streamBody).
    let handedOff = false;
    // A new id per attempt: a reused one is refused detachment by the gateway.
    if (options.turn) {
      options.turn.id = (0, _e2eeCrypto.bytesToHex)((0, _utils.randomBytes)(16));
      options.turn.cancelled = false;
      init = {
        ...init,
        headers: {
          ...init.headers,
          'X-Mera-Turn-Id': options.turn.id
        }
      };
    }
    try {
      const response = await (0, _fetch.fetch)(url, {
        ...init,
        signal
      });

      // ONE re-mint, latched. A 401 that survives a fresh JWT is a dead
      // session, and re-minting against it just multiplies the auth breaker's
      // evidence while the user waits.
      if (response.status === 401 && !reminted && attempt < lastAttempt) {
        reminted = true;
        _logger.default.warn(`${TAG} 401 on attempt ${attempt + 1}, refreshing JWT once`);
        (0, _auth.invalidateJwtCache)();
        const freshHeaders = await getAuthHeaders();
        init = {
          ...init,
          headers: {
            ...init.headers,
            ...freshHeaders
          }
        };
        await (0, _sleep.sleep)(backoffWithJitter(attempt));
        continue;
      }

      // 429 — the gateway is throttling THIS USER. Back the whole device off
      // either way; the lanes differ only in whether this call waits it out.
      //
      // Previously absent entirely: a 429 fell through to `return response`,
      // so chat/complete/batch neither paused the limiter nor retried, while
      // every other gateway caller in the app did pause. The user got
      // `E2EE chat failed: 429` and the device kept re-storming.
      if (response.status === 429) {
        const retryAfterMs = retryAfterMsFrom(response.headers);
        gatewayRateLimiter.pauseFor(retryAfterMs);
        const waitable = lane === 'background' || retryAfterMs <= gatewayRateLimiter.INTERACTIVE_MAX_PAUSE_MS;
        if (!throttleRetried && waitable && attempt < lastAttempt) {
          throttleRetried = true;
          _logger.default.warn(`${TAG} 429 on attempt ${attempt + 1}, retrying once`, {
            retryAfterMs,
            lane
          });
          // NO sleep: the next attempt's acquire() waits out the pause we just
          // set. Sleeping here as well would serve the same backoff twice.
          continue;
        }
        // An interactive caller does not sit on a long throttle with a live
        // composer and no way out. The device is paused regardless, so the
        // user's retry lands on an already-paced limiter.
        _logger.default.warn(`${TAG} 429 on attempt ${attempt + 1}, surfacing`, {
          retryAfterMs,
          lane,
          throttleRetried
        });
        throw new RateLimitedError(retryAfterMs);
      }

      // The router's to answer: the next profile, not the same model again.
      if (options.failFast && response.status >= 500) return response;
      if (response.status === 502) {
        // 502 = the gateway couldn't get a verdict from NEAR within its own
        // UPSTREAM_TIMEOUT_MS (a cold model). Retrying against the SAME cold
        // model just storms, so this counts against the (chat-capped) timeout
        // budget; once exhausted we surface the 502 rather than loop.
        timeoutAttempts += 1;
        if (timeoutAttempts < maxTimeoutAttempts && attempt < lastAttempt) {
          _logger.default.warn(`${TAG} 502 on attempt ${attempt + 1}, retrying`);
          await (0, _sleep.sleep)(backoffWithJitter(attempt));
          continue;
        }
        _logger.default.warn(`${TAG} 502 on attempt ${attempt + 1} — timeout budget exhausted (${timeoutAttempts}/${maxTimeoutAttempts}), surfacing`);
        return response;
      }
      if (response.status >= 500 && attempt < lastAttempt) {
        // Non-502 5xx (500/503/504) — transient gateway/app errors, keep the
        // original sane retry budget.
        _logger.default.warn(`${TAG} ${response.status} on attempt ${attempt + 1}, retrying`);
        await (0, _sleep.sleep)(backoffWithJitter(attempt));
        continue;
      }
      if (options.streamBody) {
        // Headers are in, the body is not. Drop the 130s header timer but keep
        // the caller-signal bridge attached so an abort still cancels the
        // in-flight body (on the RN polyfill path nothing else would).
        clearTimeout(timeoutId);
        handedOff = true;
        streamHandles.set(response, {
          abort: () => controller.abort(),
          release
        });
      }
      return response;
    } catch (err) {
      // Our own deliberate throttle verdict, raised INSIDE the try. Without
      // this it lands in the network-error path below, which counts it against
      // the cold-upstream budget and retries — re-storming the very gateway
      // that just asked us to stop.
      if (err instanceof RateLimitedError) throw err;
      // A caller abort ends the call here: no budget spent, no retry, no sleep.
      if (init.signal?.aborted) {
        throw new CallerAbortError('authFetch: caller aborted', err);
      }
      // The turn may be alive in the store: the caller reads it, no re-send here.
      if (options.turn && left()) throw new AppLeftError();
      lastError = err instanceof Error ? err : new Error(String(err));
      const isAbort = isAbortLike(lastError);
      if (isAbort) {
        _logger.default.warn(`${TAG} request timed out after ${requestTimeoutMs}ms (attempt ${attempt + 1})`, {
          url
        });
      }
      // Our own deadline on a routed call is the router's to answer.
      if (options.failFast && isAbort) break;
      // Timeout/network failures share the cold-upstream budget with 502s. The
      // time away is not one of them.
      if (!left()) timeoutAttempts += 1;
      if (attempt < lastAttempt && timeoutAttempts < maxTimeoutAttempts) {
        // Its socket is gone and its reply will not be read.
        if (options.turn) cancelTurn(options.turn);
        _logger.default.warn(`${TAG} fetch error on attempt ${attempt + 1}, retrying`, {
          error: lastError.message,
          timedOut: isAbort
        });
        await (0, _sleep.sleep)(backoffWithJitter(attempt));
      } else {
        break;
      }
    } finally {
      if (!handedOff) {
        clearTimeout(timeoutId);
        release();
      }
    }
  }
  throw lastError ?? new Error('authFetch failed after retries');
}