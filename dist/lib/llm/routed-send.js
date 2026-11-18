"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.attemptOnProfile = attemptOnProfile;
exports.chainFor = chainFor;
exports.perRequestProfile = perRequestProfile;
exports.sendOnLane = sendOnLane;
exports.sendToProfile = sendToProfile;
var _reactNative = require("../platform/react-native");
var _appRestart = require("../app-restart");
var _gatewayFetch = require("./gateway-fetch");
var _onDeviceGate = require("./on-device-gate");
var _profiles = require("./profiles");
var _providerE2ee = require("./provider-e2ee");
var _router = require("./router");
// routed-send: one cloud call, profile by profile down its lane's order (lib/llm/router).
//
// A model-class failure (lib/llm/router failureClassOf: a 5xx, the gateway's model_unavailable,
// an attestation failure, an empty reply, a missed first-token deadline) marks the profile and the
// next one is sent AT ONCE: no backoff, no jitter wait. Everything else surfaces untouched: 401
// keeps its one re-mint and 429 its pause inside authFetch, a stop and the app leaving are never
// evidence. When every profile failed, the lane is out: one error event, then the last profile's
// FIRST failure surfaces (the head's, as the old fallback did: a later profile must never mask
// the real error), so callers see the same errors they always did.

/** A request that reached the gateway: its answer, the context that opens it, and who served it. */

/** The profiles `lane` would try, in order (empty for a batch when only RedPill is left). Throws when the mode keeps the lane off the cloud. */
function chainFor(lane, opts = {}) {
  if (!(0, _router.laneRoutes)(lane)) throw new _onDeviceGate.OnDeviceModeError();
  return (0, _router.routeLane)(lane, opts);
}

/**
 * One send to one profile. A 5xx comes back as a fresh, still-readable response plus its
 * failure class (its body is read here, once, for the gateway's fast-fail verdict and table);
 * any other answer comes back with a null class. A throw is the caller's to classify.
 */
async function sendToProfile(url, lane, profile, build, options) {
  const built = await build(profile);
  const init = {
    ...built.init,
    headers: {
      ...built.init.headers,
      ...(0, _providerE2ee.providerHeader)(profile)
    },
    ...(options.signal ? {
      signal: options.signal
    } : {})
  };
  const response = await (0, _gatewayFetch.authFetch)(url, init, {
    ...options,
    requestTimeoutMs: options.requestTimeoutMs ?? (0, _profiles.firstTokenDeadlineMs)(profile, lane),
    failFast: true,
    turn: built.turn
  });
  (0, _router.noteRoutingVersion)(response.headers?.get('X-Mera-Routing'));
  if (response.status < 500) return {
    leg: {
      response,
      ctx: built.ctx,
      profile
    },
    failure: null
  };
  (0, _gatewayFetch.takeStreamHandle)(response)?.release();
  const body = await response.text().catch(() => '');
  try {
    (0, _router.applyRoutingTable)(JSON.parse(body).routing);
  } catch {
    // Not JSON: an upstream error page carries no table.
  }
  const replay = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
  return {
    leg: {
      response: replay,
      ctx: built.ctx,
      profile
    },
    failure: (0, _router.failureClassOfStatus)(response.status, body)
  };
}

/** One request to one profile, settled: its answer, or its error and whether that is model evidence. */

/** Sends once to `profile` and reads the answer. Nothing that happens while the app is away is a verdict on the model. */
async function attemptOnProfile(url, lane, profile, build, read, options) {
  const left = (0, _appRestart.departureMark)();
  try {
    const {
      leg,
      failure
    } = await sendToProfile(url, lane, profile, build, options);
    if (failure && !left()) {
      // `read` turns a 5xx into the error callers have always seen.
      const error = await read(leg).then(() => new Error(`${failure} on ${profile.id}`), e => e);
      return {
        error,
        failure
      };
    }
    return {
      out: await read(leg)
    };
  } catch (err) {
    return {
      error: err,
      failure: left() ? null : (0, _router.failureClassOf)(err)
    };
  }
}

/**
 * The lane's sync-only profile (RedPill) when it can serve right now: unmarked, and the app in
 * front, because its v2 envelope expires in 300 s and must not be held across a suspension.
 */
function perRequestProfile(lane) {
  if (_reactNative.AppState.currentState !== 'active') return null;
  return (0, _router.routeLane)(lane).find(p => !(0, _profiles.servesBatch)(p) && !(0, _router.isProfileMarked)(p.id)) ?? null;
}

/**
 * Sends on `lane` and reads the answer with `read`, moving down the chain on every model-class
 * failure, whether it showed in the status or in the body `read` opened (an empty reply). `build`
 * MUST construct its payload from scratch each time: E2EE encrypts in place and every profile has
 * its own attestation key.
 *
 * `perRequest` is for a call the chain's profiles serve as one request (a batch) that a sync-only
 * profile can serve as several: it runs on that profile (perRequestProfile) after the chain failed,
 * or at once when every chain profile is marked.
 */
async function sendOnLane(url, lane, build, read, options, route = {}, perRequest) {
  const failed = [];
  const settle = (profile, a) => {
    if ('out' in a) {
      (0, _router.reportProfileSuccess)(profile, lane);
      return a;
    }
    if (!a.failure) throw a.error;
    (0, _router.reportProfileFailure)(profile, lane, a.failure);
    failed.push({
      profile,
      failure: a.failure,
      error: a.error
    });
    return null;
  };
  const chain = chainFor(lane, route);
  if (chain.length === 0) (0, _router.refreshRoutingSoon)();
  const skipChain = perRequest !== undefined && chain.every(p => (0, _router.isProfileMarked)(p.id)) && perRequestProfile(lane) !== null;
  for (const profile of skipChain ? [] : chain) {
    const done = settle(profile, await attemptOnProfile(url, lane, profile, build, read, options));
    if (done) return done.out;
  }
  const fallback = perRequest ? perRequestProfile(lane) : null;
  if (perRequest && fallback) {
    const done = settle(fallback, await perRequest(fallback));
    if (done) return done.out;
  }
  const last = failed.at(-1);
  (0, _router.reportLaneExhausted)(lane, last?.profile ?? null, last?.failure ?? 'model_unavailable');
  // The head's first error, so a later profile never masks the real one; with nothing to try, the lane's.
  throw failed.length > 0 ? failed[0].error : new _router.LaneExhaustedError(lane);
}