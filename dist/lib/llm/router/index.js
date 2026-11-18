"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "CHAT_LANES", {
  enumerable: true,
  get: function () {
    return _lanes.CHAT_LANES;
  }
});
Object.defineProperty(exports, "LANES", {
  enumerable: true,
  get: function () {
    return _lanes.LANES;
  }
});
exports.MARK_MS = exports.LaneExhaustedError = void 0;
exports.__resetRouterForTests = __resetRouterForTests;
exports.applyRoutingTable = applyRoutingTable;
exports.failureClassOf = failureClassOf;
exports.failureClassOfStatus = failureClassOfStatus;
exports.isProfileMarked = void 0;
exports.laneRoutes = laneRoutes;
exports.noteRoutingVersion = noteRoutingVersion;
exports.profilesToPreattest = profilesToPreattest;
exports.refreshRouting = refreshRouting;
exports.refreshRoutingSoon = refreshRoutingSoon;
exports.reportLaneExhausted = reportLaneExhausted;
exports.reportProfileFailure = reportProfileFailure;
exports.reportProfileSuccess = reportProfileSuccess;
exports.routeLane = routeLane;
exports.routingSnapshot = routingSnapshot;
exports.routingVersion = void 0;
exports.useRoutingState = useRoutingState;
var _react = require("react");
var _zustand = require("zustand");
var _endpoints = require("../../config/endpoints");
var _logger = _interopRequireDefault(require("../../logger"));
var _networkStore = require("../../stores/network-store");
var gatewayRateLimiter = _interopRequireWildcard(require("../gateway-rate-limiter"));
var _gatewayFetch = require("../gateway-fetch");
var _profiles = require("../profiles");
var _lanes = require("./lanes");
var _harnesses = require("../../harnesses");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The model router: which profile serves a lane, in what order, and what a failure means.
//
// Order comes from the gateway's routing table (GET /v1/routing, fetched on launch and again
// whenever a reply's X-Mera-Routing version differs from the one held), or DEFAULT_TABLE when
// the gateway has not answered. A model-class failure marks the profile for this process and the
// caller moves to the next one at once: no backoff, no jitter. A marked profile sinks to the end
// of the order rather than leaving it, so a lane always has something to try and a recovered
// model is found by the next call that gets that far.
//
// Mode-aware: in on-device mode the cloud lanes route nothing, except the chat lanes while the
// reader has chat in the cloud on. assertCloudAllowed stays the backstop at every entry point.
//
// Sentry: an absorbed failure is a breadcrumb; a lane whose whole chain failed is ONE error event.
// Stores are required lazily: their modules build collections at import time.

/** What a model failure was. Everything else (401, 429, offline, a stop, the app leaving) is not one. */

// the reply could not be read as what the caller asked for

/** A profile marked failed stays at the end of the order this long, unless a newer table or a success clears it.
 *  Longer than a background lane's 120s deadline, or a slow chain would forget its first mark before its last try. */
const MARK_MS = exports.MARK_MS = 300_000;
/** A failed table fetch is not retried sooner than this, however many replies name a new version. */
const REFRESH_FLOOR_MS = 10_000;
const ROUTING_URL = `${_endpoints.INFERENCE_ENDPOINT}/v1/routing`;
const ROUTING_TIMEOUT_MS = 10_000;
const defaultTable = () => ({
  version: 0,
  lanes: {}
});
let table = defaultTable();
const marks = new Map();
let refreshing = null;
let lastRefreshAt = 0;

/** Bumped on every change a reader can see; useRoutingState re-reads on it. */
const useRouterTick = (0, _zustand.create)(() => ({
  tick: 0
}));
const bump = () => useRouterTick.setState(s => ({
  tick: s.tick + 1
}));
function modeState() {
  try {
    const {
      useMeraProtocolStore
    } = require("../../stores/mera-protocol-store");
    return useMeraProtocolStore.getState();
  } catch {
    return null;
  }
}

/** False for a cloud lane while processing is on the phone, unless it is chat and chat is in the cloud. */
function laneRoutes(lane) {
  const s = modeState();
  if (!s || s.processingMode !== 'ON_DEVICE') return true;
  return _lanes.CHAT_LANES.includes(lane) && s.chatInCloud === true;
}
const isMarked = (id, now) => {
  const at = marks.get(id);
  if (at === undefined) return false;
  if (now - at < MARK_MS) return true;
  marks.delete(id);
  return false;
};
/** True while `id` is marked failed (diagnostics and tests). */
const isProfileMarked = id => isMarked(id, Date.now());

/** The profiles to try for `lane`, healthy first. Empty only when the mode keeps the lane off the cloud. */
exports.isProfileMarked = isProfileMarked;
function routeLane(lane, opts = {}) {
  if (!laneRoutes(lane)) return [];
  const entry = table.lanes[lane];
  const listed = (entry?.profiles ?? []).filter(_profiles.isProfileId);
  // The table lists only healthy profiles, so a down lane has nothing to try: no attestation and no
  // send, the caller fails as chain-exhausted. refreshRoutingSoon() is how it finds the way back.
  if (entry?.state === 'down' && listed.length === 0) return [];
  const ranked = listed.length > 0 ? listed : _profiles.DEFAULT_TABLE[lane];
  const now = Date.now();
  const healthy = ranked.filter(id => !isMarked(id, now));
  const sick = ranked.filter(id => isMarked(id, now));
  return [...healthy, ...sick].map(id => _profiles.PROFILES[id])
  // A harness names the lanes its model qualified for; a table listing it elsewhere is ignored.
  .filter(p => (0, _harnesses.loadHarness)(p.harness).lanes.includes(lane)).filter(p => !opts.batch || (0, _profiles.servesBatch)(p));
}
function setLaneOutage(lane, info) {
  try {
    const {
      useForYouStore
    } = require("../../stores/for-you-store");
    useForYouStore.getState().setLaneOutage?.(lane, info);
  } catch {
    // The store could not load (a test without a database): the outage line is the only loss.
  }
}

/** A model-class failure on `profile`: it sinks to the end of every lane's order. Breadcrumb only. */
function reportProfileFailure(profile, lane, failureClass) {
  marks.set(profile.id, Date.now());
  _logger.default.addBreadcrumb('model profile failed, next profile', 'router', {
    lane,
    profile: profile.id,
    failure_class: failureClass,
    routing_version: table.version
  }, 'warning');
  bump();
}

/** `profile` answered on `lane`: its mark goes and the lane's outage ends. */
function reportProfileSuccess(profile, lane) {
  setLaneOutage(lane, null);
  if (marks.delete(profile.id)) bump();
}

/** Content-free: carries the lane only. Thrown as is when a lane had no profile it could try; a 503 to every outage check. */
class LaneExhaustedError extends Error {
  constructor(lane) {
    super(`Every model profile failed on lane ${lane}`);
    this.statusCode = 503;
    this.name = 'LaneExhaustedError';
  }
}

/** Every profile on `lane` failed: the lane is out, and Sentry gets its one error event. */
exports.LaneExhaustedError = LaneExhaustedError;
function reportLaneExhausted(lane, profile, failureClass) {
  setLaneOutage(lane, {
    since: Date.now()
  });
  _logger.default.captureException(new LaneExhaustedError(lane), {
    level: 'error',
    tags: {
      lane,
      profile: profile?.id ?? 'none',
      failure_class: failureClass,
      routing_version: String(table.version)
    },
    fingerprint: ['lane-exhausted', lane]
  });
}

/**
 * Is `err` evidence about the model? Returns its class, or null for everything that is not:
 * a stop, the app leaving, a throttle, a privacy refusal, a dead session, and anything at all
 * while the device is offline (an offline socket times out exactly like a stalled model).
 */
function failureClassOf(err) {
  if (!_networkStore.useNetworkStore.getState().isConnected) return null;
  if ((0, _gatewayFetch.isCallerAbort)(err) || err instanceof _gatewayFetch.AppLeftError || err instanceof _gatewayFetch.RateLimitedError) return null;
  if (err instanceof _gatewayFetch.CleartextToolCallError) return null;
  if (err instanceof _gatewayFetch.EmptyReplyError) return 'empty';
  if (err instanceof _gatewayFetch.StreamIdleError) return 'deadline';
  const name = err?.name;
  if (name === 'AttestationVerifyError' || name === 'ModelKeyValidationError') return 'attestation';
  const status = err?.statusCode;
  if (name === 'NearAttestationError') {
    // 4xx is the session or the request, never the model; an empty 2xx is the provider's.
    const s = typeof status === 'number' ? status : 0;
    return s >= 500 || s >= 200 && s < 300 ? 'attestation' : null;
  }
  // An HTTP answer was classified by its status before it became an error; its body may say "abort".
  if (typeof status === 'number') return null;
  // A report the provider served in a shape the key cannot be read from (lib/e2ee throws these untyped).
  if (err instanceof Error && /^(NEAR|RedPill) attestation: /.test(err.message)) return 'attestation';
  if ((0, _gatewayFetch.isAbortLike)(err)) return 'deadline';
  return null;
}

/** The class of a gateway HTTP answer, or null when the status says nothing about the model. */
function failureClassOfStatus(status, body) {
  if (status < 500) return null;
  if (status === 503 && /model_unavailable/.test(body)) return 'model_unavailable';
  return 'upstream';
}

/** Takes a /v1/routing body (or the `routing` field of a fast-fail 503). Ignores anything malformed. */
function applyRoutingTable(body) {
  const t = body;
  if (!t || typeof t.version !== 'number' || typeof t.lanes !== 'object' || t.lanes === null) return;
  if (t.version === table.version) return;
  table = {
    version: t.version,
    updatedAt: t.updatedAt,
    lanes: t.lanes
  };
  // The gateway re-probed since our marks: its word is fresher.
  marks.clear();
  for (const lane of _lanes.LANES) {
    if (t.lanes[lane]?.state === 'down') setLaneOutage(lane, {
      since: Date.now()
    });
  }
  bump();
}

/** Fetches the routing table. Never throws; on failure the table held (or the default) stays. */
function refreshRouting() {
  if (refreshing) return refreshing;
  lastRefreshAt = Date.now();
  refreshing = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROUTING_TIMEOUT_MS);
    try {
      // Unauthenticated and content-free, but still a gateway request: it waits its turn.
      await gatewayRateLimiter.acquire('background', controller.signal);
      const res = await fetch(ROUTING_URL, {
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`routing ${res.status}`);
      applyRoutingTable(await res.json());
    } catch (err) {
      _logger.default.debug('[router] routing table fetch failed, keeping the table held', {
        error: String(err)
      });
    } finally {
      clearTimeout(timer);
      refreshing = null;
    }
  })();
  return refreshing;
}

/** A lane the table says is down sends nothing, so no reply can name a newer table: ask for one, at most every REFRESH_FLOOR_MS. */
function refreshRoutingSoon() {
  if (Date.now() - lastRefreshAt >= REFRESH_FLOOR_MS) void refreshRouting();
}

/** Every gateway reply names the table version; a different one means ours is stale. */
function noteRoutingVersion(header) {
  if (header == null || header === '') return;
  const version = Number(header);
  if (!Number.isFinite(version) || version === table.version) return;
  if (Date.now() - lastRefreshAt < REFRESH_FLOOR_MS) return;
  void refreshRouting();
}
const routingVersion = () => table.version;

/** The top two profiles of every lane that routes, once each: what a launch attests ahead of use. */
exports.routingVersion = routingVersion;
function profilesToPreattest() {
  const seen = new Map();
  for (const lane of _lanes.LANES) for (const p of routeLane(lane).slice(0, 2)) seen.set(p.id, p);
  return [...seen.values()];
}
function outageOf(lane) {
  try {
    const {
      useForYouStore
    } = require("../../stores/for-you-store");
    return Boolean(useForYouStore.getState().laneOutage?.[lane]);
  } catch {
    return false;
  }
}
const WORSE = {
  ok: 0,
  degraded: 1,
  down: 2
};
const worst = (a, b) => WORSE[a] >= WORSE[b] ? a : b;

/** Per lane, its state and the profile a call would use first (Verify reads the active profiles). */
function routingSnapshot() {
  const lanes = {};
  for (const lane of _lanes.LANES) {
    const head = routeLane(lane)[0] ?? null;
    const local = outageOf(lane) ? 'down' : head && head.id !== _profiles.DEFAULT_TABLE[lane][0] ? 'degraded' : 'ok';
    lanes[lane] = {
      state: worst(table.lanes[lane]?.state ?? 'ok', local),
      active: head && {
        id: head.id,
        provider: head.provider
      }
    };
  }
  return {
    version: table.version,
    lanes
  };
}

/** Reactive routingSnapshot(): re-reads on any router change, a mode change and a lane outage. */
function useRoutingState() {
  const {
    useMeraProtocolStore
  } = require("../../stores/mera-protocol-store");
  const {
    useForYouStore
  } = require("../../stores/for-you-store");
  const tick = useRouterTick(s => s.tick);
  const mode = useMeraProtocolStore(s => `${s.processingMode}:${s.chatInCloud}`);
  const outage = useForYouStore(s => s.laneOutage);
  return (0, _react.useMemo)(() => routingSnapshot(), [tick, mode, outage]);
}

/** Test seam: the default table, no marks, nothing in flight. */
function __resetRouterForTests() {
  table = defaultTable();
  marks.clear();
  refreshing = null;
  lastRefreshAt = 0;
  bump();
}