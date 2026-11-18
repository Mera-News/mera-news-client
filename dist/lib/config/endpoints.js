"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SHOW_EXTRACTED_METADATA = exports.REVENUECAT_IOS_KEY = exports.REVENUECAT_API_KEY = exports.REVENUECAT_ANDROID_KEY = exports.INTERCOM_IOS_KEY = exports.INTERCOM_APP_ID = exports.INTERCOM_ANDROID_KEY = exports.INFERENCE_ENDPOINT = exports.GRAPHQL_SERVER_ENDPOINT = exports.GOOGLE_WEB_CLIENT_ID = exports.GOOGLE_IOS_CLIENT_ID = exports.FORCE_UPDATE_CHECK_IN_DEV = exports.DUMP_QUERIES_ENABLED = exports.AUTH_ENDPOINT = void 0;
var Sentry = _interopRequireWildcard(require("../platform/sentry"));
var _env = require("../platform/env");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
// Centralised EXPO_PUBLIC_* endpoint resolution.
//
// Why this file exists: `process.env.EXPO_PUBLIC_*` is replaced with a string
// literal by Babel/Metro at TRANSFORM time, per file. Metro caches transformed
// output per file, and the cache key does NOT include `.env` values. So if
// `.env` changes and only some source files get re-transformed (because their
// contents changed), unchanged files keep their stale inlined values — and
// you end up with a single bundle where two modules disagree on the same
// endpoint URL.
//
// Funnelling every read through this one module means there is exactly ONE
// cached transform output for each endpoint string. Either it's fresh and
// every consumer sees the correct value, or it's stale and every consumer
// sees the same stale value — but they can never disagree. Consumers import
// the named constant and never touch `process.env` directly.
//
// Missing-env policy: fail loud at module load. Falling back to a localhost
// default in a prod build is worse than crashing — it produces silent
// connect failures that look like server outages. We capture to Sentry on
// the way out (sentry-init runs first in every entry point) and re-throw.
//
// Cache-bust marker (bump when env values change): 2026-08-13a (Intercom keys added)

function requireEnv(name, value) {
  if (!value) {
    const err = new Error(`[config/endpoints] Missing required env var EXPO_PUBLIC_${name}. ` + `Check the .env used to build / publish this bundle. ` + `Copy .env.example to .env and set this value.`);
    // Sentry.init runs first (sentry-init.ts is the first import in every
    // entry point). If it somehow didn't, captureException is a no-op rather
    // than a crash, and the throw below still surfaces via the React Native
    // unhandled-exception handler.
    try {
      Sentry.captureException(err, {
        tags: {
          module: 'config/endpoints',
          missing: name
        }
      });
    } catch {
      // Sentry not initialised yet — fall through to the throw.
    }
    throw err;
  }
  return value;
}
const INFERENCE_ENDPOINT = exports.INFERENCE_ENDPOINT = requireEnv('INFERENCE_ENDPOINT', _env.env.EXPO_PUBLIC_INFERENCE_ENDPOINT);
const AUTH_ENDPOINT = exports.AUTH_ENDPOINT = requireEnv('AUTH_ENDPOINT', _env.env.EXPO_PUBLIC_AUTH_ENDPOINT);
const GRAPHQL_SERVER_ENDPOINT = exports.GRAPHQL_SERVER_ENDPOINT = requireEnv('GRAPHQL_SERVER_ENDPOINT', _env.env.EXPO_PUBLIC_GRAPHQL_SERVER_ENDPOINT);

// Optional dev-only flag — absence means "off", which is the safe production
// default. Not gated by requireEnv.
//
// The `__DEV__ &&` interlock is the actual security control: `__DEV__` is a
// Metro-injected boolean literal that is `false` in any release/production
// build, so the whole right-hand side dead-code-eliminates to `false` in a
// release bundle regardless of what EXPO_PUBLIC_DUMP_QUERY_FOR_DEBUGGING was
// set to at bundle time. This makes the plaintext prompt dump branch
// (submitInferenceJob.ts) statically unreachable in release — it can never
// ship enabled, only run in a dev bundle.
const DUMP_QUERIES_ENABLED = exports.DUMP_QUERIES_ENABLED = __DEV__ && _env.env.EXPO_PUBLIC_DUMP_QUERY_FOR_DEBUGGING === 'true';

// RevenueCat public SDK keys. Optional (not requireEnv): subscriptions degrade
// gracefully — when unset, configureRevenueCat() no-ops and the paywall isn't
// shown. The generic Test Store key (`test_…`) works on both platforms in
// development; production uses platform-specific App Store (`appl_`) / Play
// Store (`goog_`) keys. Platform selection happens in lib/revenuecat.ts at call
// time so this module stays free of react-native imports (it loads extremely
// early, before any native module is mockable in tests).
const REVENUECAT_API_KEY = exports.REVENUECAT_API_KEY = _env.env.EXPO_PUBLIC_REVENUECAT_API_KEY || '';
const REVENUECAT_IOS_KEY = exports.REVENUECAT_IOS_KEY = _env.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '';
const REVENUECAT_ANDROID_KEY = exports.REVENUECAT_ANDROID_KEY = _env.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || '';

// Intercom keys for the in-app support Messenger. Optional (not requireEnv) for
// the same reason as the RevenueCat trio above: support degrades to a mailto:
// link when unset, and a missing key must never crash launch.
//
// Both an app id AND a platform key are required — unlike RevenueCat there is
// no generic cross-platform key, and Intercom.initialize() rejects on a key
// that does not start with `ios_sdk-` / `android_sdk-`. Platform selection
// happens in lib/intercom.ts at call time so this module stays free of
// react-native imports (it loads extremely early, before any native module is
// mockable in tests).
const INTERCOM_APP_ID = exports.INTERCOM_APP_ID = _env.env.EXPO_PUBLIC_INTERCOM_APP_ID || '';
const INTERCOM_IOS_KEY = exports.INTERCOM_IOS_KEY = _env.env.EXPO_PUBLIC_INTERCOM_IOS_KEY || '';
const INTERCOM_ANDROID_KEY = exports.INTERCOM_ANDROID_KEY = _env.env.EXPO_PUBLIC_INTERCOM_ANDROID_KEY || '';

// Google OAuth client ids, for the Drive backup provider. Optional (not
// requireEnv) for the same reason as the two groups above: a build without them
// must still launch, and Drive simply reports itself unavailable.
//
// Both are PUBLIC identifiers, inlined into the bundle and shipped in the
// binary by design. The web client's SECRET is never used by the mobile SDK and
// must not appear anywhere in this app.
//
// The web id is needed on BOTH platforms despite its name — it is the audience
// the ID token is minted for, not a website's id. There is deliberately no
// ANDROID id: that client is matched implicitly by package name plus SHA-1
// signing certificate and its id is never passed to the SDK.
const GOOGLE_WEB_CLIENT_ID = exports.GOOGLE_WEB_CLIENT_ID = _env.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
const GOOGLE_IOS_CLIENT_ID = exports.GOOGLE_IOS_CLIENT_ID = _env.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';

// Dev-only override for the mandatory-update gate. The gate skips in dev builds
// by default so the team isn't locked out while the server's min-version floor
// is set high; set EXPO_PUBLIC_FORCE_UPDATE_IN_DEV=true to exercise it locally.
// Same `__DEV__ &&` interlock as above: this is only ever consulted in dev — a
// release build runs the gate unconditionally regardless of this value.
const FORCE_UPDATE_CHECK_IN_DEV = exports.FORCE_UPDATE_CHECK_IN_DEV = __DEV__ && _env.env.EXPO_PUBLIC_FORCE_UPDATE_IN_DEV === 'true';

// Dev-only: show the article screen's extracted metadata panel (places,
// entities, event type). Owner decision: readers never see it, so there is no
// user setting; set EXPO_PUBLIC_SHOW_EXTRACTED_METADATA_IN_DEV=true to test it
// locally. Same `__DEV__ &&` interlock: false in every release bundle (an EAS
// build or an OTA), whatever the variable was at bundle time.
const SHOW_EXTRACTED_METADATA = exports.SHOW_EXTRACTED_METADATA = __DEV__ && _env.env.EXPO_PUBLIC_SHOW_EXTRACTED_METADATA_IN_DEV === 'true';