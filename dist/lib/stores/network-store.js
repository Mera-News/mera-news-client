"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports._resetNetworkTrackingForTests = _resetNetworkTrackingForTests;
exports.initNetworkListener = initNetworkListener;
exports.isOnline = isOnline;
exports.markServerUnreachable = markServerUnreachable;
exports.probeInternetReachable = probeInternetReachable;
exports.probeServerReachable = probeServerReachable;
exports.recordServerReachable = recordServerReachable;
exports.recordServerTransportFailure = recordServerTransportFailure;
exports.reportRequestSlow = reportRequestSlow;
exports.reportSlowRequestEnded = reportSlowRequestEnded;
exports.resetSlowRequests = resetSlowRequests;
exports.stopNetworkListener = stopNetworkListener;
exports.useNetworkStore = exports.useIsOnline = exports.useIsNetworkHealthy = exports.useIsConnected = void 0;
var _zustand = require("zustand");
var _logger = _interopRequireDefault(require("../logger"));
var _endpoints = require("../config/endpoints");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// NetInfo requires a native module that may not be available (e.g. Expo Go).
let NetInfo = null;
try {
  NetInfo = require("../platform/netinfo").default;
} catch (err) {
  _logger.default.captureException(err, {
    tags: {
      store: 'network-store',
      method: 'init'
    }
  });
}
const useNetworkStore = exports.useNetworkStore = (0, _zustand.create)(set => ({
  // Default false when NetInfo unavailable — conservative (avoids stale online assumption)
  isConnected: NetInfo !== null,
  serverReachable: true,
  serverSlow: false,
  internetReachable: true,
  setIsConnected: connected => set({
    isConnected: connected
  }),
  setServerReachable: reachable => set({
    serverReachable: reachable
  }),
  setServerSlow: slow => set({
    serverSlow: slow
  }),
  setInternetReachable: reachable => set({
    internetReachable: reachable
  })
}));

// ---------------------------------------------------------------------------
// Server reachability
// ---------------------------------------------------------------------------

/**
 * Consecutive failed OPERATIONS (not packets) before we call the server
 * unreachable. The Apollo error link sits upstream of the retry link, so it
 * observes one failure per operation AFTER its 3 retries are exhausted — two
 * therefore means "two distinct operations gave up", not "two dropped packets".
 */
const SERVER_FAILURE_THRESHOLD = 2;
let consecutiveTransportFailures = 0;

/**
 * A request failed with no HTTP response at all, or with a 5xx. Only evidence of
 * this shape counts: a 4xx means the server answered, and an aborted request
 * (screen unmount / tab switch) means nothing at all — see `apollo-fetch.ts`,
 * which marks its own timeouts so they can be told apart from cancellations.
 */
function recordServerTransportFailure() {
  consecutiveTransportFailures += 1;
  if (consecutiveTransportFailures < SERVER_FAILURE_THRESHOLD) return;
  if (useNetworkStore.getState().serverReachable) {
    useNetworkStore.getState().setServerReachable(false);
  }
}

/**
 * Any HTTP response at all proves the server answered — including a 4xx and
 * including a 200 carrying GraphQL errors. Resets the counter and clears the
 * unreachable flag.
 */
function recordServerReachable() {
  consecutiveTransportFailures = 0;
  const state = useNetworkStore.getState();
  if (!state.serverReachable) {
    state.setServerReachable(true);
  }
  // Real Mera traffic succeeding is strictly stronger evidence than the
  // neutral probe below: it proves the open internet was fine too. Clear a
  // stale `internetReachable: false` left over from an earlier episode (e.g.
  // a captive portal that has since been dismissed) so the NEXT unhealthy
  // episode is classified fresh rather than off expired evidence.
  if (!state.internetReachable) {
    state.setInternetReachable(true);
  }
}

/** Probe verdict — authoritative, so it bypasses the threshold. */
function markServerUnreachable() {
  consecutiveTransportFailures = SERVER_FAILURE_THRESHOLD;
  if (useNetworkStore.getState().serverReachable) {
    useNetworkStore.getState().setServerReachable(false);
  }
}

// ---------------------------------------------------------------------------
// Slow-request tracking (band signal only)
// ---------------------------------------------------------------------------

let slowInFlight = 0;

/** A request has crossed the slow threshold. */
function reportRequestSlow() {
  slowInFlight += 1;
  if (slowInFlight === 1) useNetworkStore.getState().setServerSlow(true);
}

/** A previously-slow request finally settled (resolved, rejected or aborted). */
function reportSlowRequestEnded() {
  if (slowInFlight === 0) return;
  slowInFlight -= 1;
  if (slowInFlight === 0) useNetworkStore.getState().setServerSlow(false);
}

/**
 * Drop all slow-request bookkeeping.
 *
 * Called on app-foreground (AppScheduler._onForeground). iOS freezes timers
 * while backgrounded, so a request interrupted by a background transition can
 * have its slow timer fire on resume against a promise that NEVER settles — the
 * `finally` that would decrement never runs, `slowInFlight` stays >= 1, and the
 * band is pinned for the rest of the app session. Same rationale, and the same
 * home, as the scheduler's stale-`running`-flag sweep. Self-correcting: a
 * genuinely still-slow request re-arms within SLOW_REQUEST_MS.
 */
function resetSlowRequests() {
  slowInFlight = 0;
  if (useNetworkStore.getState().serverSlow) {
    useNetworkStore.getState().setServerSlow(false);
  }
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

/** Budget for the reachability probe. Only ever spent on the ownership-fault path. */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Better Auth's health route. Verified against the deployed service: the auth
 * app is mounted at `/api/auth`, so `${AUTH_ENDPOINT}/ok` is a 404 and
 * `${AUTH_ENDPOINT}/api/auth/ok` returns 200 `{"ok":true}` (checked on both
 * prod and staging, 2026-08-03).
 */
const PROBE_PATH = '/api/auth/ok';

/**
 * One-shot, bounded probe of the AUTH server.
 *
 * Deliberately targets AUTH rather than GraphQL: the only caller is the identity
 * gate's decision about whether to eject a user into an OTP re-auth, and OTP
 * talks to the auth service on a different host. GraphQL health would be a proxy
 * for the wrong thing — a healthy GraphQL server would license an eject into an
 * OTP that cannot be sent. (GraphQL reachability is covered separately, by the
 * passive failure counter above, which observes real GraphQL traffic.)
 */
async function probeServerReachable(timeoutMs = PROBE_TIMEOUT_MS) {
  // Nothing to probe with, and the answer is already known.
  if (!useNetworkStore.getState().isConnected) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${_endpoints.AUTH_ENDPOINT}${PROBE_PATH}`, {
      method: 'GET',
      signal: controller.signal
    });
    // Any answer below 500 proves the host is up and serving. A 5xx is the
    // server telling us it is broken, which is not "reachable" for our
    // purposes — the user still could not complete an OTP.
    const reachable = response.status < 500;
    if (reachable) recordServerReachable();else markServerUnreachable();
    return reachable;
  } catch {
    // Timeout, DNS failure, TLS failure, refused connection.
    markServerUnreachable();
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Neutral reachability probe (sibling of probeServerReachable, above)
// ---------------------------------------------------------------------------

/** Budget for the neutral-internet probe. Same order of magnitude as the auth
 *  probe — this is also only ever spent to explain an already-unhealthy state,
 *  never on a hot path. */
const INTERNET_PROBE_TIMEOUT_MS = 3_000;

/**
 * Neutral, anycast connectivity-check endpoints — the exact probes iOS
 * (`captive.apple.com`) and Android (`connectivitycheck.gstatic.com`) use
 * internally to detect captive portals, i.e. a link that answers at the IP
 * layer (`isConnected: true`) while HTTP is being silently intercepted or DNS
 * is hijacked. Neither is `example.com`-style guesswork — both exist
 * specifically for this and are why they, not `AUTH_ENDPOINT`, are the right
 * host to disambiguate "no internet" from "Mera is down".
 *
 * SCHEME NOTE — read before "fixing" this to match `secure-url.ts`: both hosts
 * are canonically served over `http://`, on purpose — a captive portal has to
 * transparently rewrite the response, which only works if it can terminate the
 * connection itself, and it usually can't do that for `https://` without
 * presenting an invalid certificate. That makes `http://` the scheme the
 * checks are DESIGNED around. Verified against the deployed endpoints
 * (2026-08): both also terminate real TLS on their own valid certs and answer
 * identically over `https://`, so this probe prefers `https://` per the
 * program brief and only falls back to the canonical `http://` when the
 * `https://` attempt fails to complete (TLS blocked/reset) rather than merely
 * answering something unexpected.
 *
 * This is UNRELATED to `lib/algorithms/secure-url.ts`'s insecure-URL guard — that guard
 * is explicitly scoped to ARTICLE urls opened/shared from feed content (see
 * its own docstring), never to app-infrastructure requests, and this probe
 * never passes through `isSecureUrl`/`secureUrlOrNull`. The `http://` fallback
 * here is a deliberate, narrow, documented exception for exactly these two
 * well-known hosts — not a silent violation of the article policy.
 */
const NEUTRAL_PROBE_HOSTS = [{
  https: 'https://connectivitycheck.gstatic.com/generate_204',
  http: 'http://connectivitycheck.gstatic.com/generate_204',
  verify: async res => res.status === 204
}, {
  https: 'https://captive.apple.com/hotspot-detect.html',
  http: 'http://captive.apple.com/hotspot-detect.html',
  // Apple's check has no bodyless-204 equivalent — it answers 200 with a
  // known, tiny HTML body ("Success"). A 200 alone is not enough: that is
  // exactly what a captive portal's login page also returns.
  verify: async res => res.status === 200 && (await res.text()).includes('Success')
}];
async function probeOneNeutralHost(target, signal) {
  try {
    const res = await fetch(target.https, {
      method: 'GET',
      signal
    });
    return await target.verify(res);
  } catch {
    // A timeout is a verdict on its own (the shared AbortController fired) —
    // do not spend the remaining budget on a second, canonical-scheme
    // attempt that the same abort will just cut off too.
    if (signal.aborted) return false;
    // https itself failed to complete (TLS blocked/reset) — fall back to
    // the canonical http:// scheme these checks are actually designed for.
    try {
      const res = await fetch(target.http, {
        method: 'GET',
        signal
      });
      return await target.verify(res);
    } catch {
      return false;
    }
  }
}

/**
 * One-shot, bounded probe against neutral (non-Mera) infrastructure.
 *
 * Sibling of `probeServerReachable()` above, same shape (AbortController +
 * timeout, funnels into the store), but answers a different question: is the
 * open internet reachable AT ALL, independent of Mera. Callers use this to
 * tell "you're offline" (no link — `isConnected` already answers that, no
 * probe needed) apart from "there's a link but no internet" (captive portal /
 * DNS hijack — genuinely new information) apart from "the internet is fine,
 * only Mera is down" (a `serverReachable: false` with this probe positive).
 *
 * Races both neutral hosts and returns true the moment either one verifies —
 * this only needs ONE working path to prove the internet at large is up, and
 * anycast means a single stuck resolver shouldn't cost the whole budget.
 */
async function probeInternetReachable(timeoutMs = INTERNET_PROBE_TIMEOUT_MS) {
  // No link at all — already a certain answer, not worth a round trip.
  if (!useNetworkStore.getState().isConnected) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const reachable = await new Promise(resolve => {
      let remaining = NEUTRAL_PROBE_HOSTS.length;
      let settled = false;
      for (const host of NEUTRAL_PROBE_HOSTS) {
        probeOneNeutralHost(host, controller.signal).then(ok => {
          if (settled) return;
          if (ok) {
            settled = true;
            resolve(true);
            return;
          }
          remaining -= 1;
          if (remaining === 0) {
            settled = true;
            resolve(false);
          }
        });
      }
    });
    useNetworkStore.getState().setInternetReachable(reachable);
    return reachable;
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only: reset module-level reachability/slow bookkeeping. */
function _resetNetworkTrackingForTests() {
  consecutiveTransportFailures = 0;
  slowInFlight = 0;
}

// Unsubscribe handle for cleanup
let unsubscribe = null;

/**
 * Start listening to network state changes via NetInfo.
 * Call once from the root layout on app start.
 *
 * Seeds the store with a real `NetInfo.fetch()` read before wiring the event
 * listener — `addEventListener`'s first callback can lag, so without this a
 * cold start in airplane mode is misreported as "online" (the module-present
 * default) until that first event finally arrives.
 */
function initNetworkListener() {
  if (!NetInfo || unsubscribe) return;
  NetInfo.fetch().then(state => {
    useNetworkStore.getState().setIsConnected(state.isConnected ?? true);
  }).catch(err => {
    _logger.default.captureException(err, {
      tags: {
        store: 'network-store',
        method: 'initNetworkListener-fetch'
      }
    });
  });
  unsubscribe = NetInfo.addEventListener(state => {
    useNetworkStore.getState().setIsConnected(state.isConnected ?? true);
  });
}

/**
 * Stop listening (useful for cleanup/testing).
 */
function stopNetworkListener() {
  unsubscribe?.();
  unsubscribe = null;
}

// Selector hooks
const useIsConnected = () => useNetworkStore(s => s.isConnected);

/**
 * "We can reach Mera and it answers." Feeds the identity gate and the
 * onboarding offline guard. Excludes `serverSlow` on purpose — a slow server
 * can still complete an OTP or a mutation.
 */
exports.useIsConnected = useIsConnected;
const useIsOnline = () => useNetworkStore(s => s.isConnected && s.serverReachable);

/** Non-reactive equivalent of `useIsOnline`, for non-React callers. */
exports.useIsOnline = useIsOnline;
function isOnline() {
  const {
    isConnected,
    serverReachable
  } = useNetworkStore.getState();
  return isConnected && serverReachable;
}

/**
 * "Nothing is going to appear promptly." Feeds the offline BAND only — this is
 * the term that makes a terrible-but-working network visible.
 */
const useIsNetworkHealthy = () => useNetworkStore(s => s.isConnected && s.serverReachable && !s.serverSlow);
exports.useIsNetworkHealthy = useIsNetworkHealthy;