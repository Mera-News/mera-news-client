"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TaskNoAuthError = exports.REASON_RELEVANCE_THRESHOLD = exports.KEEP_RELEVANCE_THRESHOLD = exports.CAPABILITY_TOKEN_TTL_MS = void 0;
exports.discardLowRelevance = discardLowRelevance;
exports.fetchResults = fetchResults;
exports.finalizeStrandedBelowReasonThreshold = finalizeStrandedBelowReasonThreshold;
exports.hexToBytes = hexToBytes;
exports.isRecordNotFoundError = isRecordNotFoundError;
exports.pickResultsAuthHeader = pickResultsAuthHeader;
exports.reconstructLookups = reconstructLookups;
exports.toBatchResult = toBatchResult;
var _fetch = require("../platform/fetch");
var Sentry = _interopRequireWildcard(require("../platform/sentry"));
var _logger = _interopRequireDefault(require("../logger"));
var coldstartTimeline = _interopRequireWildcard(require("../diagnostics/coldstart-timeline"));
var _auth = require("../platform/auth");
var _e2eeService = require("../e2ee/e2ee-service");
var _articleSuggestionScoringWrites = require("../database/services/article-suggestion-scoring-writes");
var _scoringService = require("../mera-protocol/scoring-service");
var _endpoints = require("../config/endpoints");
var _abortRace = require("../llm/abort-race");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
// inference-results — shared fetch/decode/persist primitives for cloud
// inference jobs. These are the reusable helpers the multi-batch scoring
// pipeline (lib/services/scoring-pipeline.ts) builds on: authenticate + GET a
// job's /results, decrypt each row into a BatchCompletionResult, reconstruct
// the chunk→candidate lookup, and discard freshly-scored low-relevance rows.
//
// (The legacy single-slot two-phase reconciler that used to live here — and its
// submit/notify orchestration — was removed once every trigger moved to the
// pipeline; only these stateless primitives survive.)

const TAG = '[inference-results]';

// Hard wall-clock timeout on the /results GET. Without it a hung socket
// (captive portal / dead connection) leaves the await pending forever, which
// freezes the scoring poller's `runPollerTick` finally, pins `pollTickRunning`
// true, kills the 7s poller, and leaves the pipeline stuck 'running' — so
// feed-sync (which skips while scoring is in flight) never fetches again.
const RESULTS_FETCH_TIMEOUT_MS = 30_000;

/** The gateway's capability-token TTL (2h, deliberately short to cap
 *  subscription bypass). A token minted at submit is useless once the batch's
 *  `submittedAt` is older than this, so the foreground fallback skips it rather
 *  than spending a request on a guaranteed 401 that would requeue the batch. */
const CAPABILITY_TOKEN_TTL_MS = exports.CAPABILITY_TOKEN_TTL_MS = 2 * 3600_000;

/** Thrown by {@link pickResultsAuthHeader} in `task` context when no JWT can be
 *  minted. The caller exits quietly; it is not an error to report. */
class TaskNoAuthError extends Error {
  constructor() {
    super('task /results: no JWT');
    this.name = 'TaskNoAuthError';
    Object.setPrototypeOf(this, TaskNoAuthError.prototype);
  }
}

// Bucketed-relevance floor that gates phase-2 LLM reason generation. Replaces
// the old per-user notificationSensitivity knob — kept at the same value the
// old code defaulted to so behaviour is unchanged for users who never moved
// the slider. Consumed by the pipelined-batch orchestrator's impactful-subset
// gate.
//
// RELEVANCE V3 (2026-08-05): 0.3 → 0.4, moving in LOCKSTEP with
// `RENDER_GATE` (lib/stores/fact-rows-selector.ts) — the two gates are meant to
// stay numerically identical (closing the historic gap where a row could be
// feed-visible without ever getting a reason queued, or vice versa). If you
// change one, change the other.
exports.TaskNoAuthError = TaskNoAuthError;
const REASON_RELEVANCE_THRESHOLD = exports.REASON_RELEVANCE_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth + fetch
// ---------------------------------------------------------------------------

/** Build the Authorization header for a /results GET. Foreground prefers the
 *  keychain JWT and falls back to the per-batch `capabilityToken` if
 *  `getJwtToken` throws or returns null. Background uses the per-batch
 *  capability token only — never reads the keychain on a silent-push wake.
 *  Throws if no usable credential exists for the context.
 *
 *  `capabilityToken` is the batch's own per-batch token (each pipeline batch
 *  carries a distinct one). */
async function pickResultsAuthHeader(context, requestId, capabilityToken, opts = {}) {
  if (context === 'task') {
    let jwt = null;
    try {
      jwt = await (0, _abortRace.raceSignal)((0, _auth.getJwtToken)(), opts.signal);
    } catch (err) {
      // The deadline, not a missing session: let the cancellation through.
      if (opts.signal?.aborted) throw err;
      jwt = null;
    }
    if (!jwt) throw new TaskNoAuthError();
    return `Bearer ${jwt}`;
  }
  // A capability token past its TTL cannot authenticate; offering it would buy
  // a 401 that reads as `unauthorized` and requeues a job whose results are
  // still waiting on the gateway.
  // Foreground only: the silent-push wake keeps its existing behaviour (the
  // token or a quiet 'unauthorized').
  if (context === 'foreground' && capabilityToken && opts.submittedAt !== undefined && Date.now() - opts.submittedAt > CAPABILITY_TOKEN_TTL_MS) {
    capabilityToken = undefined;
  }
  if (context === 'foreground') {
    let jwt = null;
    try {
      jwt = await (0, _auth.getJwtToken)();
    } catch (err) {
      _logger.default.warn(`${TAG} foreground getJwtToken threw — trying capability token: ${String(err)}`);
    }
    if (jwt) return `Bearer ${jwt}`;
    if (capabilityToken) {
      _logger.default.warn(`${TAG} foreground using capability-token fallback for /results (JWT unavailable)`);
      return `Bearer ${capabilityToken}`;
    }
    Sentry.addBreadcrumb({
      category: 'auth',
      level: 'warning',
      message: 'foreground /results: no JWT and no capability token',
      data: {
        requestId
      }
    });
    throw new _e2eeService.NoCredentialError('no auth available (foreground)');
  }
  if (!capabilityToken) {
    Sentry.addBreadcrumb({
      category: 'auth',
      level: 'warning',
      message: 'background /results: no capability token',
      data: {
        requestId
      }
    });
    throw new Error('no capability token available (background)');
  }
  return `Bearer ${capabilityToken}`;
}
async function fetchResults(requestId, context, capabilityToken,
/** `submittedAt` drops an expired capability-token fallback; `signal` is the
 *  background task's deadline (aborting reads as 'pending'). */
opts = {}) {
  // Per-context auth.
  //   Foreground: prefer the keychain JWT; fall back to the per-batch
  //     capability token if the keychain is transiently unavailable.
  //   Background: per-batch capability token only — never touch the keychain
  //     on a silent-push wake (locked-device → SecureStore throws).
  const authHeader = await pickResultsAuthHeader(context, requestId, capabilityToken, opts);
  coldstartTimeline.mark('first-GET-results');
  const attempt = (0, _abortRace.linkedAbort)(opts.signal, RESULTS_FETCH_TIMEOUT_MS);
  const controller = {
    signal: attempt.signal
  };
  let res;
  try {
    res = await (0, _fetch.fetch)(`${_endpoints.INFERENCE_ENDPOINT}/v1/inference/jobs/${requestId}/results`, {
      method: 'GET',
      headers: {
        Authorization: authHeader
      },
      signal: attempt.signal
    });
  } catch (err) {
    // Our own timeout firing is expected behaviour, not an exception. expo/fetch
    // surfaces it as a literal `Error: aborted`, which used to propagate to the
    // caller's captureException and file a Sentry issue on every slow poll
    // (MERA-APP-5N, new with the 30s timeouts). Report it as 'pending' — the
    // job may well still be running server-side, and the caller's BATCH_STALE_MS
    // bound already stops a permanently-silent job from waiting forever.
    // `signal.aborted` is the exact test: OUR timer fired. A generic transient
    // check would also swallow real network failures, which the caller should
    // still see.
    if (controller.signal.aborted) {
      _logger.default.warn(`${TAG} results fetch timed out after ${RESULTS_FETCH_TIMEOUT_MS}ms — treating as pending`, {
        requestId
      });
      return 'pending';
    }
    throw err;
  } finally {
    attempt.dispose();
  }
  if (res.status === 404) return 'not-found';
  // The capability token carries a 2h TTL. A 401/403 here means the token
  // expired or was rejected server-side — unrecoverable by retrying with the
  // same token, so treat it like 404: the caller drops the batch/job and
  // resubmits fresh, rather than retrying forever as a transient error.
  if (res.status === 401 || res.status === 403) return 'unauthorized';
  if (!res.ok) {
    let bodyStr = '';
    try {
      const bodyText = await res.text();
      try {
        bodyStr = JSON.stringify(JSON.parse(bodyText));
      } catch {
        bodyStr = bodyText;
      }
    } catch {
      bodyStr = '<unreadable body>';
    }
    throw new Error(`results fetch ${res.status} ${bodyStr}`);
  }
  const text = await res.text();
  const parsed = JSON.parse(text);
  if (parsed && typeof parsed === 'object' && 'pending' in parsed && parsed.pending === true) {
    return 'pending';
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

function toBatchResult(row, privKey, algo) {
  if (!row.ok) {
    return {
      id: row.id,
      output: '',
      error: row.error ?? 'unknown'
    };
  }
  const choice = row.response?.choices?.[0];
  const encContent = choice?.message?.content ?? choice?.message?.reasoning_content ?? '';
  if (!encContent) return {
    id: row.id,
    output: ''
  };
  try {
    const output = (0, _e2eeService.decryptContent)(encContent, privKey, algo).trim();
    return {
      id: row.id,
      output
    };
  } catch (err) {
    return {
      id: row.id,
      output: '',
      error: err instanceof Error ? err.message : 'decrypt error'
    };
  }
}
function reconstructLookups(callIds, candidateIds,
/** The chunk size the SUBMIT built `score:N` with. Defaults to the
 *  standard size, which is what every batch built before per-chunk headline prompts used; an all-TOP-HEADLINE
 *  batch passes its (smaller) headline size, read off the batch record. */
chunkSize = _scoringService.CLOUD_SCORE_CHUNK_SIZE) {
  const chunkIdToCandidates = new Map();
  const size = chunkSize > 0 ? chunkSize : _scoringService.CLOUD_SCORE_CHUNK_SIZE;
  for (const callId of callIds) {
    if (callId.startsWith('score:')) {
      const idx = Number(callId.slice('score:'.length));
      const start = idx * size;
      const chunkIds = candidateIds.slice(start, start + size);
      const chunkCandidates = chunkIds.map(id => ({
        id,
        titleEn: null,
        descriptionEn: null,
        countryCode: null,
        userTopicIds: [],
        relatedFacts: []
      }));
      chunkIdToCandidates.set(callId, chunkCandidates);
    }
  }
  return {
    chunkIdToCandidates
  };
}

// ---------------------------------------------------------------------------
// Persist helpers
// ---------------------------------------------------------------------------

/**
 * Watermelon throws `Record <table>#<id> not found` when an update targets a
 * row that has since been deleted (typically because syncFeed dropped it after
 * the server's id-set shrank). Treat as a benign skip — not a real error.
 */
function isRecordNotFoundError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /Record\s+\S+\s+not\s+found/i.test(msg);
}

/**
 * Rows scoring BELOW this are finalized without a reason. It MUST equal
 * {@link REASON_RELEVANCE_THRESHOLD}: every scored row is then either sent for
 * a reason (at or above) or finalized (below), with no band in between.
 *
 * It used to be a separate 0.3 while the reason gate moved to 0.4 with
 * relevance v3, and rows between the two were neither: saved as
 * `reason_pending` with an empty reason, never sent for one, never finalized,
 * and skipped by the orphan sweep too (it also requires 0.4). A device
 * snapshot held 330 such rows. {@link finalizeStrandedBelowReasonThreshold}
 * clears the ones already stranded.
 */
const KEEP_RELEVANCE_THRESHOLD = exports.KEEP_RELEVANCE_THRESHOLD = REASON_RELEVANCE_THRESHOLD;

/**
 * Finalize freshly-scored rows whose relevance is below KEEP_RELEVANCE_THRESHOLD as
 * scored-low tombstones — `batchMarkReasonSkipped` sets `status=Complete` in
 * one batched write, keeping the same ids/local pk rather than deleting the
 * rows. This is the *only* path that mutates article_suggestions during a
 * cycle.
 *
 * Rows must be kept, not deleted: feed-sync's `stepDiff` compares server ids
 * against every physically-present local row, so a deleted id looks "missing"
 * on the very next sync and gets re-downloaded and re-scored — an infinite
 * discard/re-hydrate churn loop. Tombstoning avoids this because the id stays
 * present locally. The tombstones are invisible to the user (every UI layer
 * filters to `relevance > KEEP_RELEVANCE_THRESHOLD`), are never re-scored
 * (`getUnscoredSuggestionsWithFacts` only selects `status=Unscored`) or picked
 * up for reasons (`enqueueOrphanedReasons` filters to `relevance >
 * REASON_RELEVANCE_THRESHOLD`), and are eventually pruned by the 48h
 * data-cleanup task.
 *
 * (The old comment here claimed discarded ids "stay marked as processed in
 * `synced_suggestion_ids`" — that tombstone table was dropped in migration
 * v24 and nothing ever wrote to it, so this path was silently hard-deleting
 * rows and causing the churn loop described above.)
 */
async function discardLowRelevance(candidateIds, relevanceMap) {
  const toDiscard = candidateIds.filter(id => {
    const r = relevanceMap[id];
    return r !== undefined && r < KEEP_RELEVANCE_THRESHOLD;
  });
  if (toDiscard.length === 0) return 0;
  await (0, _articleSuggestionScoringWrites.batchMarkReasonSkipped)(toDiscard);
  return toDiscard.length;
}

/**
 * Finalize rows already stranded in `reason_pending` below the reason
 * threshold (see {@link KEEP_RELEVANCE_THRESHOLD} for how they got there).
 * `rows` is what the orphan sweep already read; ids a live batch still covers
 * are skipped. Idempotent: a finalized row is no longer pending, so a second
 * call finds nothing. Returns how many rows it finalized.
 */
async function finalizeStrandedBelowReasonThreshold(rows, covered) {
  const stranded = rows.filter(r => typeof r.relevance === 'number' && r.relevance < KEEP_RELEVANCE_THRESHOLD && !covered.has(r.id)).map(r => r.id);
  if (stranded.length === 0) return 0;
  await (0, _articleSuggestionScoringWrites.batchMarkReasonSkipped)(stranded);
  return stranded.length;
}
function hexToBytes(hex) {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}