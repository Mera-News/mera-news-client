"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.bytesToHex = bytesToHex;
exports.sendInferenceRequest = sendInferenceRequest;
var _fetch = require("../platform/fetch");
var _logger = _interopRequireDefault(require("../logger"));
var coldstartTimeline = _interopRequireWildcard(require("../diagnostics/coldstart-timeline"));
var _retry = require("../utils/retry");
var _transientError = require("../algorithms/transient-error");
var gatewayRateLimiter = _interopRequireWildcard(require("./gateway-rate-limiter"));
var _cloudComplete = require("./cloudComplete");
var _abortRace = require("./abort-race");
var _router = require("./router");
var _e2eeService = require("../e2ee/e2ee-service");
var _auth = require("../platform/auth");
var pako = _interopRequireWildcard(require("pako"));
var _host = require("../platform/host");
var _endpoints = require("../config/endpoints");
var _readHold = require("../subscription/read-hold");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// submitInferenceJob — the shared submit primitive for the cloud inference
// flow. `sendInferenceRequest` encrypts a bundle's calls end-to-end, gzips the
// body, POSTs it to /v1/inference/jobs, and returns the server-issued
// requestId + capability token. The multi-batch scoring pipeline
// (lib/services/scoring-pipeline.ts) owns all job state; this module is
// stateless and just performs one authenticated submit.

const TAG = '[submitInferenceJob]';
const JOBS_API = `${_endpoints.INFERENCE_ENDPOINT}/v1/inference/jobs`;

/** Report a submit that exhausted its retries. Benign timeout/abort/offline
 *  failures are logged as warnings rather than captured — the caller's outcome
 *  is `{ status: 'failed' }` either way (the batch retries), so an exception
 *  adds Sentry noise without adding signal. Genuine failures still capture. */
function reportSubmitFailure(err, status) {
  if ((0, _transientError.isTransientNetworkError)(err)) {
    _logger.default.warn(`${TAG} submit ${status} — transient network/abort`, {
      url: JOBS_API,
      message: err instanceof Error ? err.message : String(err)
    });
    return;
  }
  _logger.default.captureException(err, {
    tags: {
      service: 'submitInferenceJob',
      status
    },
    extra: {
      url: JOBS_API
    }
  });
}

/** Outcome of a single `sendInferenceRequest` call.
 *  - `read-held`: the day's cloud reading is used up (a 429
 *    `daily-quota-exceeded`, or a hold already in force, in which case nothing
 *    was sent). The read hold is set; requeue with the SAME key and attempt
 *    count. Never a failure, never reported, never a limiter pause.
 *  - `throttled`: the gateway returned 429 — transient, non-terminal (the
 *    rate limiter was already told to back off via `pauseFor`).
 *  - `in-progress`: 409, the gateway still holds this `Idempotency-Key`'s
 *    reservation from an earlier attempt whose outcome is unknown. Treat like
 *    `throttled`: requeue WITHOUT a new key, and the next attempt replays.
 *  - `no-auth`: `task` context only — no JWT could be minted, or the gateway
 *    refused it. Quiet by design (no Sentry, no auth-breaker report).
 *  - `failed`: a definite failure; the caller may mint a new key.
 *  - `model-failed`: the gateway fast-failed the job because the model is down
 *    (503 `model_unavailable`; its routing table is already applied). Model
 *    evidence: the caller marks the profile and sends the work to the next one.
 *    Nothing was created, so no retry here and no attempt spent. */

/**
 * Shared submit primitive: encrypt the bundle's calls end-to-end, gzip the
 * body, POST to /v1/inference/jobs, return the server-issued requestId +
 * capability token. Caller is responsible for persisting whatever job state it
 * needs from the outcome.
 */
async function sendInferenceRequest(args) {
  const {
    bundle,
    ctx,
    token,
    model,
    context,
    capabilityToken,
    grantAlreadyHeld = false,
    idempotencyKey,
    singleAttempt = false,
    signal,
    provider = 'near'
  } = args;

  // The one place a job is POSTed, so the one gate every caller passes. While
  // the day's reading is used up, sending would only collect another 429.
  if ((0, _readHold.isReadHeld)()) return {
    status: 'read-held'
  };
  if (_endpoints.DUMP_QUERIES_ENABLED) {
    dumpPromptsForDev(bundle.calls).catch(err => {
      _logger.default.warn(`${TAG} prompt dump failed: ${String(err)}`);
    });
  }

  // If every BatchCall in the bundle shares an identical system prompt
  // (true for phase-1 score chunks and phase-2 reason calls by construction),
  // encrypt it ONCE and hoist it to the top-level `sharedSystem` field. The
  // gateway prepends it to each request's messages[] before proxying — saves
  // ~37–44% of raw body bytes vs. repeating the ciphertext per call.
  const sharedSystemPlaintext = computeSharedSystem(bundle.calls);
  const sharedSystem = sharedSystemPlaintext ? (0, _e2eeService.encryptContent)(sharedSystemPlaintext, ctx) : null;
  const encryptedCalls = bundle.calls.map(call => {
    const messages = [];
    if (!sharedSystem && call.system.length > 0) {
      messages.push({
        role: 'system',
        content: (0, _e2eeService.encryptContent)(call.system, ctx)
      });
    }
    if (call.prompt.length > 0) {
      messages.push({
        role: 'user',
        content: (0, _e2eeService.encryptContent)(call.prompt, ctx)
      });
    }
    return {
      id: call.id,
      body: {
        messages,
        stream: false,
        temperature: call.temperature ?? 0.3,
        model,
        chat_template_kwargs: {
          enable_thinking: call.enableThinking ?? false
        },
        ...(call.maxTokens !== undefined && {
          max_tokens: call.maxTokens
        })
      }
    };
  });

  // Build the persisted session object: forwardable E2EE headers that the
  // gateway processor replays upstream when the job runs.
  const e2eeSession = {};
  for (const [k, v] of Object.entries(ctx.headers)) {
    if (typeof v === 'string') e2eeSession[k] = v;
  }
  const body = {
    e2eeSession,
    requests: encryptedCalls
  };
  // Only include the token when present — the gateway DTO accepts its absence
  // (tokenless submit) but rejects an empty/invalid token via @Matches.
  if (token) body.expoPushToken = token;
  if (sharedSystem) body.sharedSystem = sharedSystem;
  const bodyJson = JSON.stringify(body);
  const gzipped = pako.gzip(bodyJson);
  const rawBytes = bodyJson.length;
  const gzippedBytes = gzipped.length;
  const ratio = rawBytes > 0 ? gzippedBytes / rawBytes * 100 : 0;
  _logger.default.debug(`${TAG} payload: calls=${bundle.calls.length} raw=${rawBytes}B gzipped=${gzippedBytes}B (${ratio.toFixed(1)}%)`);

  // Per-context auth.
  //   Foreground: prefer the keychain JWT. If `getJwtToken` throws or
  //     returns null (keychain transiently unavailable, session expired,
  //     etc.) AND the caller passed a capability token, fall back to that —
  //     beats failing the whole call.
  //   Background: caller-supplied capability token only. Never read the
  //     keychain from a silent-push wake; the device may be locked and
  //     SecureStore items pinned to AfterFirstUnlock would throw
  //     `keychain-unavailable`.
  let authHeader;
  if (context === 'task') {
    // JWT only, quiet on absence. A locked-since-reboot keychain or a dead
    // session is not an error the user can act on from a background run.
    let jwt = null;
    try {
      jwt = await (0, _abortRace.raceSignal)((0, _auth.getJwtToken)(), signal);
    } catch {
      jwt = null;
    }
    if (!jwt) return {
      status: 'no-auth'
    };
    authHeader = `Bearer ${jwt}`;
  } else if (context === 'foreground') {
    let jwt = null;
    try {
      jwt = await (0, _auth.getJwtToken)();
    } catch (err) {
      _logger.default.warn(`${TAG} foreground getJwtToken threw — falling back to capability token if present: ${String(err)}`);
    }
    if (jwt) {
      authHeader = `Bearer ${jwt}`;
    } else {
      if (!capabilityToken) {
        // NoCredentialError, not a plain Error: the scoring pipeline's quiet
        // classifier maps it to 'no-auth' (batch stops, no Sentry event, no
        // auth-breaker report) — a foreground submit with no mintable JWT and
        // no chained capability token is a missing credential, not a defect.
        throw new _e2eeService.NoCredentialError('sendInferenceRequest: foreground has no JWT and no capability token');
      }
      _logger.default.warn(`${TAG} foreground using capability-token fallback (JWT unavailable)`);
      authHeader = `Bearer ${capabilityToken}`;
    }
  } else {
    if (!capabilityToken) {
      throw new Error('sendInferenceRequest: no capability token (background)');
    }
    authHeader = `Bearer ${capabilityToken}`;
  }

  // Serial FIFO gate shared by every inference-gateway HTTP call (submits and
  // polls) — enforces the gateway's per-IP throttle (30 req/60s counting
  // both) well under the limit before we even attempt the POST.
  //
  // SKIPPED when the caller already holds a grant — the slot is paid either
  // way, so charging twice only delays the POST (see `grantAlreadyHeld`).
  if (!grantAlreadyHeld) {
    try {
      await (0, _abortRace.raceSignal)(gatewayRateLimiter.acquire('background'), signal);
    } catch {
      // The deadline passed while waiting for a slot: nothing was sent.
      return {
        status: 'failed'
      };
    }
  }

  // Last thing before the bytes leave the device — one site covering every
  // submit path.
  coldstartTimeline.mark('first-batch-POST', `calls=${bundle.calls.length}`);

  // Hard wall-clock timeout per POST attempt. A hung submit socket would
  // otherwise pin the poller's drain/tick in-flight, leaving the pipeline stuck
  // 'running' and blocking all future feed-sync fetches. On timeout the abort
  // throws, so withRetry retries; exhausting retries returns { status: 'failed' }.
  const SUBMIT_TIMEOUT_MS = 30_000;
  const headers = {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
    // Tells the gateway this client understands the reading meter's 429
    // contract. Without it (shipped bundles) the gateway refuses over-limit
    // submits with a 402, which those bundles treat as a plain failure and
    // never as a limiter pause.
    'X-Mera-Reading': '1',
    'X-Mera-Provider': provider
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  // Set when the gateway fast-failed the job for a down model: never retried, the next profile is.
  let modelDown = null;
  const doSubmitPost = bearer => (0, _retry.withRetry)(async () => {
    const attempt = (0, _abortRace.linkedAbort)(signal, SUBMIT_TIMEOUT_MS);
    let r;
    try {
      r = await (0, _fetch.fetch)(JOBS_API, {
        method: 'POST',
        headers: {
          ...headers,
          Authorization: bearer
        },
        body: gzipped,
        signal: attempt.signal
      });
    } finally {
      attempt.dispose();
    }
    if (r.status >= 500) {
      const text = await r.text().catch(() => '');
      if ((0, _router.failureClassOfStatus)(r.status, text) === 'model_unavailable') {
        try {
          (0, _router.applyRoutingTable)(JSON.parse(text).routing);
        } catch {
          // No table in the body: the next reply's X-Mera-Routing refetches it.
        }
        modelDown = 'model_unavailable';
        return r;
      }
      throw new Error(`${TAG} submit failed (${r.status}): ${text.slice(0, 200)}`);
    }
    return r;
  }, signal, singleAttempt ? 0 : 4, TAG);
  let res;
  try {
    res = await doSubmitPost(authHeader);
  } catch (err) {
    // The CALLER's deadline fired mid-POST. The gateway may already have
    // accepted it, so this is not a failure: report it like a 409 so the
    // caller keeps the idempotency key and the attempt count, and the next
    // attempt replays to the same job instead of billing a second one.
    if (signal?.aborted) {
      _logger.default.debug(`${TAG} submit aborted by the caller's deadline — outcome unknown`);
      return {
        status: 'in-progress'
      };
    }
    // Exhausting retries on a benign timeout/abort is expected on flaky mobile
    // links, and the outcome ({ status: 'failed' } → the batch retries) is the
    // same either way — so it doesn't warrant a Sentry exception. Our own 30s
    // SUBMIT_TIMEOUT_MS abort surfaces here as a literal `Error: aborted`
    // (MERA-APP-5N). Genuine failures still report.
    reportSubmitFailure(err, 'retry-exhausted');
    return {
      status: 'failed'
    };
  }
  if (modelDown) return {
    status: 'model-failed',
    failureClass: modelDown
  };

  // 401/403 recovery — foreground (JWT) only. Mirrors authFetch's idiom
  // (lib/llm/cloudComplete.ts): invalidate the cached JWT, re-mint once, retry
  // the POST once. A background submit has no re-mint path (the keychain is
  // never read in that context — see ExecutionContext) so a stale capability
  // token there is left alone: it says nothing about the Better Auth session,
  // so recordAuthFailure() would be a false signal. Both cases fall through to
  // the standard non-202 handling below, which captures + returns failed.
  // Task context: a refused JWT means the session is gone or not readable. Exit
  // quietly — never a re-mint loop, never recordAuthFailure (which can pause
  // feed-sync), never a logout. The next foreground owns the recovery.
  if ((res.status === 401 || res.status === 403) && context === 'task') {
    return {
      status: 'no-auth'
    };
  }
  if ((res.status === 401 || res.status === 403) && context === 'foreground') {
    _logger.default.warn(`${TAG} ${res.status} on submit — invalidating JWT cache and re-minting once`);
    (0, _auth.invalidateJwtCache)();
    const freshJwt = await (0, _auth.getJwtToken)().catch(() => null);
    if (freshJwt) {
      authHeader = `Bearer ${freshJwt}`;
      try {
        res = await doSubmitPost(authHeader);
      } catch (err) {
        reportSubmitFailure(err, 'retry-exhausted-after-401');
        return {
          status: 'failed'
        };
      }
      if (modelDown) return {
        status: 'model-failed',
        failureClass: modelDown
      };
    }
    if (res.status === 401 || res.status === 403) {
      (0, _auth.recordAuthFailure)();
    }
  }
  const quota = await dailyQuotaRefusal(res);
  if (quota) {
    // The day's reading is used up. NOT a throttle: Retry-After runs to the
    // daily reset, and pausing the shared limiter for it would stall chat,
    // attestation and every poll. Hold cloud scoring instead.
    await (0, _readHold.setReadHold)({
      resetAt: quota.resetAt,
      used: 1
    }, {
      serverNow: (0, _readHold.serverNowFromDateHeader)(res.headers.get('Date'))
    });
    _logger.default.debug(`${TAG} daily reading used up — holding until ${new Date(quota.resetAt).toISOString()}`);
    return {
      status: 'read-held'
    };
  }
  if (res.status === 429) {
    // Transient, non-terminal — the gateway is asking us to back off, not
    // reporting a permanent failure. Don't let withRetry burn attempts on
    // it (it already didn't — only >=500 throws inside the retry closure);
    // instead push the shared rate limiter's next grant out and let the
    // caller decide whether/when to resubmit.
    const retryAfterMs = (0, _cloudComplete.retryAfterMsFrom)(res.headers);
    gatewayRateLimiter.pauseFor(retryAfterMs);
    _logger.default.warn(`${TAG} throttled (429) — pausing gateway calls for ${retryAfterMs}ms`);
    return {
      status: 'throttled'
    };
  }
  if (res.status === 409) {
    // The gateway still holds this key's reservation (an earlier attempt with
    // the same key is mid-create). Not a failure and not a new job: the caller
    // keeps the key and retries later, when it replays to the original job.
    _logger.default.debug(`${TAG} 409 — idempotency key still reserved, treating as in progress`);
    return {
      status: 'in-progress'
    };
  }
  if (res.status !== 202) {
    const text = await res.text().catch(() => '');
    // Was logger.warn — that's only a breadcrumb, so the failure stayed
    // silent and the only Sentry signal was the 30s empty-feed watchdog.
    // Surface as an exception so the *source* of a stalled cycle is loud.
    // `statusCode` as a FIELD, not only interpolated into the message: the
    // app's 401 rule (logger.captureException) reads the status off the error
    // object, and an Error whose status exists only in its text is invisible to
    // it — which is how a dead session kept reporting from here as well as from
    // the auth breaker (MERA-APP-6Q).
    _logger.default.captureException(Object.assign(new Error(`${TAG} submit failed ${res.status}`), {
      statusCode: res.status
    }), {
      tags: {
        service: 'submitInferenceJob',
        status: String(res.status)
      },
      extra: {
        url: JOBS_API,
        status: res.status,
        body: text.slice(0, 500)
      }
    });
    return {
      status: 'failed'
    };
  }
  const usedHeader = res.headers.get('X-Mera-Reading-Used');
  if (usedHeader != null && usedHeader.trim() !== '') {
    const used = Number(usedHeader);
    if (Number.isFinite(used)) {
      void (0, _readHold.setReadHold)({
        used
      }, {
        serverNow: (0, _readHold.serverNowFromDateHeader)(res.headers.get('Date'))
      });
    }
  }
  const {
    requestId,
    capabilityToken: issuedCapabilityToken
  } = await res.json();
  if (!requestId) {
    _logger.default.captureException(new Error(`${TAG} submit succeeded but no requestId`), {
      tags: {
        service: 'submitInferenceJob'
      },
      extra: {
        url: JOBS_API,
        status: res.status
      }
    });
    return {
      status: 'failed'
    };
  }

  // The gateway-issued capability token is bound to (userId, requestId,
  // scopes={results:read, jobs:submit-followup}) with a 2h TTL, kept short on
  // purpose to cap subscription bypass. It covers the /results GET and the
  // phase-2 follow-up POST inside that window; past it, only the JWT works.
  // Storing it is the caller's responsibility.
  if (!issuedCapabilityToken) {
    _logger.default.warn(`${TAG} gateway returned no capabilityToken — falling back to JWT auth on subsequent calls`);
  }
  return {
    status: 'ok',
    requestId,
    capabilityToken: issuedCapabilityToken ?? ''
  };
}

/**
 * A 429 (or the 402 the gateway sends clients without `X-Mera-Reading`) whose
 * body is `{code:'daily-quota-exceeded', resetAt}`. Returns the reset as epoch
 * ms; without a usable `resetAt` it is the next 00:00 UTC, which the contract
 * fixes (Retry-After is capped at 60s for this client and says nothing about
 * the reset). Anything else, a non-JSON body included, is null and keeps its
 * ordinary handling. Reads the body as text, no `clone()`: the later branches
 * either never read it (429) or tolerate an empty read (402).
 */
async function dailyQuotaRefusal(res) {
  if (res.status !== 429 && res.status !== 402) return null;
  let body = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return null;
  }
  if (!body || body.code !== 'daily-quota-exceeded') return null;
  const parsed = typeof body.resetAt === 'string' ? Date.parse(body.resetAt) : NaN;
  if (Number.isFinite(parsed)) return {
    resetAt: parsed
  };
  return {
    resetAt: (0, _readHold.nextUtcMidnight)((0, _readHold.serverNowFromDateHeader)(res.headers.get('Date')) ?? Date.now())
  };
}

/**
 * If every call in the bundle shares the same non-empty `system` plaintext,
 * return that plaintext for hoisting into the job's top-level `sharedSystem`
 * field. Return null when calls disagree or the system is empty — in that
 * case each request carries its own system message inline.
 */
function computeSharedSystem(calls) {
  if (calls.length === 0) return null;
  const first = calls[0].system;
  if (!first || first.length === 0) return null;
  for (let i = 1; i < calls.length; i++) {
    if (calls[i].system !== first) return null;
  }
  return first;
}

/**
 * DEV-ONLY: hand the plaintext (pre-encryption) prompts to the host as a
 * timestamped .md file (`devDump`); the host decides where it lands.
 */
async function dumpPromptsForDev(calls) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${ts}-calls-${calls.length}.md`;
  const parts = [`# Inference job — ${new Date().toISOString()}`, `Calls: ${calls.length}`, ''];
  for (const call of calls) {
    parts.push(`---`);
    parts.push(`## Call \`${call.id}\``);
    parts.push(`temp: ${call.temperature ?? 0.3}${call.maxTokens !== undefined ? ` · max_tokens: ${call.maxTokens}` : ''}`);
    parts.push('');
    parts.push(`### System`);
    parts.push('```');
    parts.push(call.system);
    parts.push('```');
    parts.push('');
    parts.push(`### User`);
    parts.push('```');
    parts.push(call.prompt);
    parts.push('```');
    parts.push('');
  }
  (0, _host.devDump)(fileName, parts.join('\n'));
  _logger.default.info(`${TAG} [dev] dumped prompts → ${fileName}`);
}
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}