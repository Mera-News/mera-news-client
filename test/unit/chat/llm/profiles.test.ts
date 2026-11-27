// The default routing table is what every lane uses when the gateway's table has not answered,
// so a wrong entry is invisible until an outage. These pins exist so a change is deliberate.
import { CHAT_MODELS, DEFAULT_TABLE, PROFILES, SCORING_MODELS, firstTokenDeadlineMs } from '@/lib/llm/profiles';
import { DEFAULT_HARNESS_CONFIG } from '@/lib/news-harness/core/config';
import { LANES } from '@/lib/llm/router/lanes';

describe('profiles and the default table', () => {
  it('ships the contract profiles plus the qualified RedPill models with their provider model ids', () => {
    expect(Object.fromEntries(Object.values(PROFILES).map((p) => [p.id, [p.provider, p.model, p.harness]]))).toEqual({
      'near/qwen3.8-27b': ['near', 'Qwen/Qwen3.8-27B', 'qwen3.8-27b'],
      'near/qwen3.6-35b-a3b': ['near', 'Qwen/Qwen3.6-35B-A3B-FP8', 'qwen3.6-35b-a3b'],
      'redpill/qwen3.8-27b': ['redpill', 'qwen/qwen3.8-27b', 'qwen3.8-27b'],
      'redpill/gemma-4-31b': ['redpill', 'google/gemma-4-31b-it', 'gemma-4-31b'],
    });
  });

  it('ranks every lane per the contract, every profile once', () => {
    // Same lists as mera-inference-gateway src/routing/profiles.ts LANES.
    const chat = ['near/qwen3.6-35b-a3b', 'redpill/qwen3.8-27b', 'redpill/gemma-4-31b', 'near/qwen3.8-27b'];
    const bulk = ['near/qwen3.6-35b-a3b', 'near/qwen3.8-27b', 'redpill/qwen3.8-27b', 'redpill/gemma-4-31b'];
    expect(DEFAULT_TABLE).toEqual({
      'chat-tools': chat, 'chat-single': chat,
      scoring: bulk, topics: bulk, background: bulk,
    });
    for (const lane of LANES) expect(new Set(DEFAULT_TABLE[lane]).size).toBe(DEFAULT_TABLE[lane].length);
  });

  it('builds the chat lanes from CHAT_MODELS and the bulk lanes from SCORING_MODELS', () => {
    expect(DEFAULT_TABLE['chat-tools']).toBe(CHAT_MODELS);
    expect(DEFAULT_TABLE['chat-single']).toBe(CHAT_MODELS);
    for (const lane of ['scoring', 'topics', 'background'] as const) expect(DEFAULT_TABLE[lane]).toBe(SCORING_MODELS);
  });

  it("keeps the news harness's RN-free model literal on the scoring head", () => {
    expect(DEFAULT_HARNESS_CONFIG.articlePipeline.model).toBe(PROFILES[SCORING_MODELS[0]].model);
  });

  it('gives chat lanes 30s to a first token and the rest 120s', () => {
    for (const p of Object.values(PROFILES)) {
      expect(firstTokenDeadlineMs(p, 'chat-tools')).toBe(30_000);
      expect(firstTokenDeadlineMs(p, 'chat-single')).toBe(30_000);
      expect(firstTokenDeadlineMs(p, 'scoring')).toBe(120_000);
    }
  });
});
