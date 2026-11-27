// The model profiles the app ships: one (provider, provider model id) pair each, with its
// harness from lib/harnesses/mapping.json. A profile id is `<provider>/<harness folder>`.
// The routing table (gateway GET /v1/routing, or DEFAULT_TABLE below) ranks them per lane.
import type { E2EEProvider } from '../e2ee/provider';
import { harnessFolderFor, loadHarness } from '../harnesses';
import type { HarnessParams } from '../harnesses/types';
import type { Lane } from './router/lanes';

export type Provider = E2EEProvider;

export type ProfileId =
  | 'near/qwen3.8-27b'
  | 'near/qwen3.6-35b-a3b'
  | 'redpill/qwen3.8-27b'
  | 'redpill/gemma-4-31b';

export interface Profile {
  id: ProfileId;
  provider: Provider;
  /** Sent as `model`, exactly as the provider names it. */
  model: string;
  /** Folder under lib/harnesses. */
  harness: string;
  params: HarnessParams;
}

function profile(provider: Provider, model: string): Profile {
  const harness = harnessFolderFor(provider, model);
  if (!harness) throw new Error(`no harness mapped for ${provider}:${model}`);
  return { id: `${provider}/${harness}` as ProfileId, provider, model, harness, params: loadHarness(harness).params };
}

export const PROFILES: Record<ProfileId, Profile> = {
  'near/qwen3.8-27b': profile('near', 'Qwen/Qwen3.8-27B'),
  'near/qwen3.6-35b-a3b': profile('near', 'Qwen/Qwen3.6-35B-A3B-FP8'),
  'redpill/qwen3.8-27b': profile('redpill', 'qwen/qwen3.8-27b'),
  'redpill/gemma-4-31b': profile('redpill', 'google/gemma-4-31b-it'),
};

export const isProfileId = (id: string): id is ProfileId => id in PROFILES;

/**
 * Chat lanes (tool-calling chat, article chat, the quick fact check): ordered by SPEED alone,
 * fastest first, among the profiles that pass the evals. Measured end to end with E2EE through
 * staging on the follow corpus (2026-11-27, p50 per turn): Qwen3.6 2.6s, RedPill Qwen3.8
 * 2.4-3.6s, Gemma 5.0s, NEAR Qwen3.8 16-19s.
 */
export const CHAT_MODELS: ProfileId[] = ['near/qwen3.6-35b-a3b', 'redpill/qwen3.8-27b', 'redpill/gemma-4-31b', 'near/qwen3.8-27b'];

/**
 * Scoring, topics and background: ordered by speed AND cost, among the profiles that pass the
 * evals. RedPill serves no batch or async job (`servesBatch`), so its profiles come last.
 */
export const SCORING_MODELS: ProfileId[] = ['near/qwen3.6-35b-a3b', 'near/qwen3.8-27b', 'redpill/qwen3.8-27b', 'redpill/gemma-4-31b'];

/** The gateway's seed ranking, used whenever /v1/routing has not answered. Mirrors
 *  mera-inference-gateway src/routing/profiles.ts. */
export const DEFAULT_TABLE: Record<Lane, ProfileId[]> = {
  'chat-tools': CHAT_MODELS,
  'chat-single': CHAT_MODELS,
  scoring: SCORING_MODELS,
  topics: SCORING_MODELS,
  background: SCORING_MODELS,
};

/**
 * Can `profile` serve a batch (/v1/chat/completions/batch) or an async job (/v1/inference/jobs)?
 * RedPill cannot: its v2 envelope is one request each (a fresh nonce, a timestamp within 300s),
 * and a batch or a job shares one header set and runs it later.
 */
export const servesBatch = (profile: Profile): boolean => profile.provider !== 'redpill';

/** Named, as a link, in each Verify attestation result. */
export const PROVIDER_INFO: Record<Provider, { name: string; url: string }> = {
  near: { name: 'NEAR AI', url: 'https://near.ai' },
  redpill: { name: 'RedPill', url: 'https://redpill.ai' },
};


/** First-token deadline for `lane` on `profile`; a buffered call's whole answer counts as its first token. */
export function firstTokenDeadlineMs(profile: Profile, lane: Lane): number {
  return profile.params.firstTokenDeadlineMs[lane] ?? 120_000;
}
