"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PROVIDER_INFO = exports.PROFILES = exports.DEFAULT_TABLE = void 0;
exports.firstTokenDeadlineMs = firstTokenDeadlineMs;
exports.servesBatch = exports.isProfileId = void 0;
var _harnesses = require("../harnesses");
// The model profiles the app ships: one (provider, provider model id) pair each, with its
// harness from lib/harnesses/mapping.json. A profile id is `<provider>/<harness folder>`.
// The routing table (gateway GET /v1/routing, or DEFAULT_TABLE below) ranks them per lane.

function profile(provider, model) {
  const harness = (0, _harnesses.harnessFolderFor)(provider, model);
  if (!harness) throw new Error(`no harness mapped for ${provider}:${model}`);
  return {
    id: `${provider}/${harness}`,
    provider,
    model,
    harness,
    params: (0, _harnesses.loadHarness)(harness).params
  };
}
const PROFILES = exports.PROFILES = {
  'near/qwen3.8-27b': profile('near', 'Qwen/Qwen3.8-27B'),
  'near/qwen3.6-35b-a3b': profile('near', 'Qwen/Qwen3.6-35B-A3B-FP8'),
  'redpill/qwen3.8-27b': profile('redpill', 'qwen/qwen3.8-27b'),
  'redpill/gemma-4-31b': profile('redpill', 'google/gemma-4-31b-it'),
  'redpill/kimi-k2.6': profile('redpill', 'moonshotai/kimi-k2.6')
};
const isProfileId = id => id in PROFILES;

// Chat lanes rank fastest first, measured end to end with E2EE through staging on the follow
// corpus (2026-11-27, p50 per turn): qwen3.6 2.6s, redpill qwen3.8 2.4-3.6s, gemma 5.0s, near
// qwen3.8 16-19s. Bulk lanes keep Qwen first (the prompts are Qwen-tuned). Kimi K2.6 is in no
// lane: RedPill stopped offering E2EE v2 for it. Mirrors mera-inference-gateway src/routing/profiles.ts.
exports.isProfileId = isProfileId;
const CHAT = ['near/qwen3.6-35b-a3b', 'redpill/qwen3.8-27b', 'redpill/gemma-4-31b', 'near/qwen3.8-27b'];
const BULK = ['near/qwen3.6-35b-a3b', 'near/qwen3.8-27b', 'redpill/qwen3.8-27b', 'redpill/gemma-4-31b'];

/** The gateway's seed ranking, used whenever /v1/routing has not answered. */
const DEFAULT_TABLE = exports.DEFAULT_TABLE = {
  'chat-tools': CHAT,
  'chat-single': CHAT,
  scoring: BULK,
  topics: BULK,
  background: BULK
};

/**
 * Can `profile` serve a batch (/v1/chat/completions/batch) or an async job (/v1/inference/jobs)?
 * RedPill cannot: its v2 envelope is one request each (a fresh nonce, a timestamp within 300s),
 * and a batch or a job shares one header set and runs it later.
 */
const servesBatch = profile => profile.provider !== 'redpill';

/** Named, as a link, in each Verify attestation result. */
exports.servesBatch = servesBatch;
const PROVIDER_INFO = exports.PROVIDER_INFO = {
  near: {
    name: 'NEAR AI',
    url: 'https://near.ai'
  },
  redpill: {
    name: 'RedPill',
    url: 'https://redpill.ai'
  }
};

/** First-token deadline for `lane` on `profile`; a buffered call's whole answer counts as its first token. */
function firstTokenDeadlineMs(profile, lane) {
  return profile.params.firstTokenDeadlineMs[lane] ?? 120_000;
}