"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PING_DEADLINE_MS = void 0;
exports.markChatFailed = markChatFailed;
exports.markChatReady = markChatReady;
exports.prewarmCloudChat = prewarmCloudChat;
exports.useChatReadiness = void 0;
var _zustand = require("zustand");
var _auth = require("../platform/auth");
var _logger = _interopRequireDefault(require("../logger"));
var _cloudChatStore = require("../stores/cloud-chat-store");
var _userStore = require("../stores/user-store");
var _chatCloud = require("./chat-cloud");
var _cloudComplete = require("./cloudComplete");
var _prompt = require("../news-harness/readiness-ping/prompt");
var _providerE2ee = require("./provider-e2ee");
var _router = require("./router");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// prewarm.ts — warm the cloud-chat critical path so the first real turn isn't
// gated on cold attestation + JWT fetches, AND so the NEAR model itself is warm.
//
// The first cloud chat turn must (1) fetch the model's TEE attestation from the
// gateway — an UNCACHED NEAR pass-through, the slow hop — (2) mint a JWT, and
// (3) hit a possibly-COLD model (the dominant, multi-second cost the attestation
// + JWT warming alone can't touch). (1) and (2) are cached client-side
// (attestation ~30 min, JWT ~30 s); (3) has no client cache, so on EVERY chat
// open (owner, 2026-10-22) we ping the chat model for the word "ready", and the chat
// header shows how that went. Only an open passes `ping`; app launch warms (1) and (2) only.
//
// Fire-and-forget and idempotent: repeated calls hit the underlying caches / the
// in-flight ping, so mounting several chat surfaces in one session costs at most
// one real fetch of each until the caches expire. No-op while chat runs on the
// phone (no gateway hop). Errors are swallowed with a debug log — a failed
// prewarm simply means the first real turn pays the original cost.

/** The chat header badge: how the last readiness ping went. Memory only; 'idle' shows nothing. */
const useChatReadiness = exports.useChatReadiness = (0, _zustand.create)(() => ({
  status: 'idle'
}));
const setReadiness = status => useChatReadiness.setState({
  status
});

/** A cloud chat turn came back: the model answers, whatever the ping said. */
function markChatReady() {
  setReadiness('ready');
}

/** A cloud chat turn failed: the badge must not say Ready beside the failure banner. */
function markChatFailed() {
  setReadiness('error');
}

// One ping in flight at a time, so two open paths firing together send one.
let pinging = false;
// The badge's own deadline: cloudComplete's timeouts and fallback can run for minutes.
// A reply that lands later still turns it to ready.
const PING_DEADLINE_MS = exports.PING_DEADLINE_MS = 60_000;

/**
 * Kick off the attestation + JWT fetches and, on a chat open (`ping`), the
 * readiness ping. Returns immediately (void); all warming runs in the background.
 */
function prewarmCloudChat(opts = {}) {
  // Chat on the phone never touches the gateway: nothing to warm, no badge.
  if (!(0, _chatCloud.chatRunsInCloud)()) {
    _logger.default.debug('[chat-timing] prewarm skipped (on-device)');
    setReadiness('idle');
    return;
  }
  const startMs = Date.now();
  // THE TOP TWO PROFILES OF EACH LANE, once each (today: both NEAR Qwen
  // models). On launch the routing table is fetched alongside; until it
  // answers the built-in order decides. Later profiles attest lazily, inside the build of
  // the send that reaches them: every gateway call takes a limiter grant, and
  // each extra fetch here pushes pingModel(), the dominant cold-start cost this
  // file exists for, a further interval out.
  void Promise.allSettled([...(0, _router.profilesToPreattest)().map(p => (0, _providerE2ee.attestProfile)(p, 'interactive')), (0, _auth.getJwtToken)(),
  // Launch only: a chat open does not refetch it; a reply naming a new version does.
  ...(opts.ping ? [] : [(0, _router.refreshRouting)()])]).then(results => {
    const failed = results.filter(r => r.status === 'rejected');
    _logger.default.debug('[chat-timing] prewarm settled', {
      ms: Date.now() - startMs,
      failed: failed.length
    });
    for (const r of failed) {
      _logger.default.debug('[chat-timing] prewarm task failed (swallowed)', {
        error: String(r.reason)
      });
    }
  });

  // Warm the MODEL itself (fire-and-forget, silent): only when a chat opens.
  if (opts.ping) void pingModel();
}

/**
 * One fixed E2EE call on the chat-tools lane so its model is loaded before the
 * user's first real turn; its outcome drives the header badge. The request is
 * two constants: no user data, no language, no clock. Fully silent: no Sentry,
 * no toast. The badge says error after PING_DEADLINE_MS without a reply.
 */
async function pingModel() {
  if (pinging) return;
  // A restricted account cannot chat, so it is never told Mera is ready.
  if (_cloudChatStore.useCloudChatStore.getState().isBlocked || _userStore.useUserStore.getState().userPersona?.blockedByLlm) {
    setReadiness('idle');
    return;
  }
  pinging = true;
  setReadiness('warming');
  // A failed turn's banner is stale once this ping answers; one that lands mid-ping is newer than the proof.
  const errorBefore = _cloudChatStore.useCloudChatStore.getState().error;
  const deadline = setTimeout(() => {
    if (useChatReadiness.getState().status === 'warming') setReadiness('error');
  }, PING_DEADLINE_MS);
  try {
    const token = await (0, _auth.getJwtToken)();
    // Signed out: nothing to ping with, and no badge.
    if (!token) {
      setReadiness('idle');
      return;
    }
    // A plain reply, not a tool call: the app sends tools as text inside the
    // sealed envelope, so a tool leg would only make the ping bigger.
    const reply = await (0, _cloudComplete.cloudComplete)({
      systemPrompt: _prompt.READINESS_PING_SYSTEM,
      prompt: _prompt.READINESS_PING_PROMPT,
      route: 'chat-tools',
      maxTokens: 8,
      temperature: 0,
      purpose: 'chat'
    }, {
      lane: 'interactive'
    });
    // Any non-empty 2xx reply proves the model answers; the exact word is not required.
    setReadiness(reply ? 'ready' : 'error');
    const chat = _cloudChatStore.useCloudChatStore.getState();
    if (reply && errorBefore !== null && chat.error === errorBefore) chat.setError(null);
    _logger.default.debug('[chat-timing] readiness ping done', {
      empty: !reply
    });
  } catch (err) {
    setReadiness('error');
    // Best-effort only — swallow everything (no Sentry, no toast).
    _logger.default.debug('[chat-timing] readiness ping failed (swallowed)', {
      error: String(err)
    });
  } finally {
    clearTimeout(deadline);
    pinging = false;
  }
}