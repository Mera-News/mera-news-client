// completeLocal (lib/llm/completeLocal.ts) against the host's scripted built-in model.
import { activeHolds } from '@/lib/app-restart';
import { completeLocal } from '@/lib/llm/completeLocal';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
import '@/test/helpers';
import { decideCalls, installLlama, llamaCalls, resetChatModules } from '@/test/integration/chat/_helpers';

const ask = (extra: Partial<Parameters<typeof completeLocal>[0]> = {}) =>
  completeLocal({ systemPrompt: 'sys', prompt: 'user', ...extra });

beforeEach(async () => {
  resetChatModules();
  installLlama(['ok']);
});

describe('the built-in model writes the text', () => {
  it('answers through the built-in model and writes no model state', async () => {
    installLlama(['hello world']);
    const states: string[] = [];
    const unsub = useMeraProtocolStore.subscribe((s) => states.push(s.modelState));

    await expect(ask()).resolves.toBe('hello world');
    unsub();

    // The text goes to the built-in model only: Kev is never asked to write.
    expect(decideCalls()).toHaveLength(0);
    expect(states).toEqual([]);
  });

  it('trims the reply', async () => {
    installLlama(['   clean output   ']);
    await expect(ask()).resolves.toBe('clean output');
  });
});

describe('request forwarding', () => {
  it('sends the system prompt and the prompt, with 512 tokens and temperature 0.3 by default', async () => {
    await ask({ prompt: 'u' });

    expect(llamaCalls()).toEqual([
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'u' },
        ],
        params: expect.objectContaining({ maxTokens: 512, temperature: 0.3 }),
      }),
    ]);
  });

  it('forwards explicit maxTokens and temperature', async () => {
    await ask({ maxTokens: 256, temperature: 0.7 });
    expect(llamaCalls()[0].params).toMatchObject({ maxTokens: 256, temperature: 0.7 });
  });
});

describe('errors', () => {
  it('propagates a failure from the built-in model and releases the restart hold', async () => {
    installLlama({ tokens: [], error: 'ERR_AFM_CONTEXT' });
    await expect(ask()).rejects.toThrow('ERR_AFM_CONTEXT');
    expect(activeHolds()).not.toContain('local-inference');
  });

  it('a failed call does not wedge the lock: the next call runs', async () => {
    installLlama((call) => (llamaCalls().indexOf(call) === 0 ? { tokens: [], error: 'ERR_AFM_BUSY' } : ['fine']));
    await expect(ask()).rejects.toThrow('ERR_AFM_BUSY');
    await expect(ask()).resolves.toBe('fine');
  });
});
