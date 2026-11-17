// lib/mera-protocol/topic-generation-service through the on-device engine: completeLocalStructured
// and the inference queue run for real, with only the built-in model (scripted on the test host) faked.
// The on-device reply is read by
// topicsFromReply; parseTopicsFromOutput is the cloud parser (combo pass, top-up), pinned here as is.
//
// The service is LOCAL ONLY by design (cloud topics come from the skill core's topic-gen handler
// in lib/mera-harness) and FACT ONLY (on-device has no combination pass), so the cloud half is the
// test that nothing reaches the gateway.
import logger from '@/lib/logger';
import { generateTopicsForFact } from '@/lib/mera-protocol/topic-generation-service';
import { parseTopicsFromOutput } from '@/lib/news-harness/persona-management/topic-generation';
import { TOPIC_GEN_SYSTEM } from '@/lib/news-harness/on-device/topic-gen/prompt';
import { countTokens } from '@/lib/news-harness/on-device/shared';
import { ProcessingMode } from '@/lib/generated/graphql-types';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
import { gatewayCalls, testHost } from '@/test/helpers';
import { installLlama, llamaCalls, type LlamaCall } from '@/test/integration/chat/_helpers/llama';
import { resetChatModules } from '@/test/integration/chat/_helpers';

jest.setTimeout(30_000);

beforeEach(() => {
  resetChatModules();
  installLlama(['ok']);
  useMeraProtocolStore.getState().setModelState('downloaded');
  useMeraProtocolStore.getState().setProcessingMode(ProcessingMode.OnDevice);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
});

const userOf = (c: LlamaCall) => c.messages.find((m) => m.role === 'user')?.content ?? '';
const systemOf = (c: LlamaCall) => c.messages.find((m) => m.role === 'system')?.content ?? '';
/** The built-in model reports busy and unavailable as errors carrying a code; the scripted model puts the code in the message. */
function codeErrors(): void {
  const model = testHost.onDeviceModel!;
  testHost.onDeviceModel = {
    ...model,
    inferStructured: <T>(params: Parameters<typeof model.inferStructured>[0]) =>
      model.inferStructured<T>(params).catch((e: Error) => {
        throw Object.assign(e, { code: e.message });
      }),
  };
}
const inputs = (over: Partial<Parameters<typeof generateTopicsForFact>[0]> = {}) => ({
  factStatement: 'Works in AI',
  userLocation: null,
  otherFacts: [],
  useCloud: false,
  ...over,
});
const topicsReply = (...topics: string[]) => [JSON.stringify({ topics })];

// ===========================================================================
// parseTopicsFromOutput (the cloud parser, unchanged)
// ===========================================================================

describe('parseTopicsFromOutput', () => {
  const fact = 'Lives in Amsterdam';
  const warn = jest.fn();
  const parse = (output: string) => parseTopicsFromOutput(output, fact, { ...console, warn } as never);
  beforeEach(() => warn.mockReset());

  it('parses a valid JSON array of strings', () => {
    expect(parse('["Amsterdam news", "Dutch politics"]')).toEqual(['Amsterdam news', 'Dutch politics']);
  });

  it('filters out non-string elements, empty strings and whitespace-only strings', () => {
    expect(parse('["AI news", 42, null, "tech policy"]')).toEqual(['AI news', 'tech policy']);
    expect(parse('["AI news", "", "  ", "tech"]')).toEqual(['AI news', 'tech']);
  });

  it('trims whitespace from each topic', () => {
    expect(parse('["  AI news  ", " tech "]')).toEqual(['AI news', 'tech']);
  });

  it('caps results at 20 topics', () => {
    const arr = Array.from({ length: 25 }, (_, i) => `topic ${i}`);
    expect(parse(JSON.stringify(arr))).toHaveLength(20);
  });

  it.each([
    ['text around the array', 'Here are the topics: ["Amsterdam news", "EU regulation"] , end', ['Amsterdam news', 'EU regulation']],
    ['a markdown code fence', '```json\n["Amsterdam news", "EU tech"]\n```', ['Amsterdam news', 'EU tech']],
    ['trailing text after the bracket', '["Amsterdam news", "EU regulation"] some note', ['Amsterdam news', 'EU regulation']],
  ])('uses the bracket fallback for %s', (_label, output, expected) => {
    expect(parse(output)).toEqual(expected);
  });

  it('returns [] and warns when the output is completely unparseable', () => {
    expect(parse('no json here')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([[''], ['[]']])('returns [] for %j', (output) => {
    expect(parse(output)).toEqual([]);
  });
});

// ===========================================================================
// generateTopicsForFact - the request it builds (on the built-in model)
// ===========================================================================

describe('generateTopicsForFact: the request', () => {
  it('asks once, with the {topics} schema and the on-device prompt, and keeps the clean topics', async () => {
    installLlama(topicsReply('AI news', '  ML research ', ''));

    const result = await generateTopicsForFact(inputs());

    expect(result).toEqual(['AI news', 'ML research']);
    expect(llamaCalls()).toHaveLength(1);
    const [call] = llamaCalls();
    expect(systemOf(call)).toBe(TOPIC_GEN_SYSTEM);
    expect(userOf(call)).toContain('Fact: "Works in AI"');
    expect(userOf(call)).toMatch(/Generate 10 topics\.$/);
    expect(call.params).toMatchObject({ maxTokens: 1024, temperature: 0.3 });
    expect(call.params.schema).toMatchObject({ type: 'object', required: ['topics'], properties: { topics: { type: 'array', maxItems: 10 } } });
  });

  it('sends the fact alone: no other facts and no location line (no combination pass on this phone)', async () => {
    installLlama(topicsReply('AI news'));

    await generateTopicsForFact(inputs({ userLocation: 'Lives in a city', otherFacts: ['another fact'] }));

    expect(llamaCalls()).toHaveLength(1);
    expect(userOf(llamaCalls()[0])).not.toMatch(/User location|Lives in a city|another fact/);
  });

  it('respects a custom totalCount, raising the ceiling only past 1024 tokens', async () => {
    installLlama(topicsReply('topic a', 'topic b', 'topic c'));
    await generateTopicsForFact(inputs({ totalCount: 3 }));
    expect(userOf(llamaCalls()[0])).toContain('Generate 3 topics.');
    expect(llamaCalls()[0].params.maxTokens).toBe(1024);

    installLlama(topicsReply('x'));
    await generateTopicsForFact(inputs({ totalCount: 40 }));
    expect(llamaCalls()[0].params.maxTokens).toBe(1200);
  });

  it('tells the model which topics not to repeat when asked for more', async () => {
    installLlama(topicsReply('fresh topic'));

    await generateTopicsForFact(inputs({ excludeTopics: ['old topic'] }));

    expect(userOf(llamaCalls()[0])).toContain('Do NOT repeat these existing topics:\n- old topic');
  });

  it('throws when the call fails for good (a refusal, not busy)', async () => {
    installLlama({ tokens: [], error: 'ERR_AFM_GUARDRAIL' });

    await expect(generateTopicsForFact(inputs())).rejects.toThrow();
  });
});

// ===========================================================================
// generateTopicsForFact - the built-in model (Apple Intelligence / Gemini Nano)
// ===========================================================================

describe('generateTopicsForFact on the built-in model', () => {
  it('a long exclusion list is cut to fit the model input: own topics first, one call, topics back', async () => {
    // Gemini Nano refuses 4000 input tokens or more, and that refusal is not deferrable: an uncut
    // list of every declined topic would fail this fact on every retry.
    installLlama(['{"topics": ["Chess clubs"]}']);
    testHost.onDeviceModel = { ...testHost.onDeviceModel!, contextSize: async () => 4000, getTextEngine: async () => 'nano' };
    const declined = Array.from({ length: 600 }, (_, i) => `declined topic number ${i} about something`);

    const topics = await generateTopicsForFact(inputs({ factStatement: 'Plays chess', excludeTopics: ['Chess openings', ...declined] }));

    expect(topics).toEqual(['Chess clubs']);
    expect(llamaCalls()).toHaveLength(1);
    const [call] = llamaCalls();
    const input = countTokens(systemOf(call)) + countTokens(userOf(call)) + countTokens(JSON.stringify(call.params.schema));
    expect(input).toBeLessThan(4000 - 1024);
    expect(userOf(call)).toContain('- Chess openings\n- declined topic number 0 about something');
    expect(userOf(call)).not.toContain('declined topic number 599');
  });

  it.each(['ERR_AFM_BUSY', 'ERR_AFM_UNAVAILABLE'] as const)('%s reaches the caller, so the queue defers the job', async (code) => {
    installLlama({ tokens: [], error: code });
    codeErrors();

    await expect(generateTopicsForFact(inputs())).rejects.toMatchObject({ code });
    expect(llamaCalls()).toHaveLength(1);
  });
});

describe('the cloud branch is retired', () => {
  it('a useCloud input never reaches the cloud: the local engine runs', async () => {
    installLlama(topicsReply('nurse staffing'));

    const result = await generateTopicsForFact(inputs({ factStatement: 'Works as a nurse', useCloud: true }));

    expect(result).toEqual(['nurse staffing']);
    expect(gatewayCalls()).toHaveLength(0);
    expect(llamaCalls()).toHaveLength(1);
  });
});
