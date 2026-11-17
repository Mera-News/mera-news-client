// Scripted on-device models: the test host's `onDeviceModel`. Text calls (infer, inferStream,
// inferStructured) answer from installLlama's script; Kev's decide() answers from installDecide.
//
// It keeps the host contract the client reads: an error that names a native code (`ERR_AFM_BUSY`)
// carries it as `code`; Kev refuses with ERR_AFM_BUSY while, or once, the app is in the background; a
// structured reply that does not parse fails with ERR_STRUCTURED_OUTPUT. The host's own retry, fence
// stripping and maxItems cut are not modelled: those are tested with the app.
//
//   beforeEach(() => { installLlama(['Hello', ' there.']); });
//
// Tokens are delivered one per macrotask (setImmediate, which the fake clock leaves real), so a
// stop between tokens is observable. `tokenDelayMs` uses setTimeout instead (fake-clock driven).
import type { OnDeviceModel } from '@/lib/platform';
import { ProcessingMode } from '@/lib/generated/graphql-types';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
import { testHost } from '@/test/helpers';

/** An error the way the native layer raises it: a message that is a code carries it as `code`. */
function nativeError(message: string): Error {
  return /^ERR_[A-Z_]+$/.test(message) ? Object.assign(new Error(message), { code: message }) : new Error(message);
}

export interface LlamaCall {
  /** Which entry point took the call. */
  kind: 'infer' | 'stream' | 'structured';
  /** The prompt as chat messages: the system prompt (when given), then the prompt. */
  messages: { role: string; content: string }[];
  params: Record<string, unknown>;
  /** The caller's signal aborted while this call ran. */
  stopped: boolean;
  /** Tokens actually delivered. */
  delivered: string[];
}

export type LlamaScript =
  | string[]
  | {
      tokens: string[];
      /** Delay between tokens through setTimeout (fake-clock driven). */
      tokenDelayMs?: number;
      /** After the tokens, keep a streamed call open until its signal aborts. */
      hang?: boolean;
      /** Reported as `truncated` (the token ceiling was hit). */
      truncated?: boolean;
      /** Reject the call with this message instead of finishing. */
      error?: string;
    };

/** One Kev `decide()` call: the request, and what the script answered (or threw). */
export interface DecideCall {
  request: { state: unknown; questions: Record<string, unknown> };
}
/** A Kev answer: the `score` of each question (0..levels-1), the option probabilities of each
 *  choice question, or an error to throw. */
export type DecideScript =
  | { scores: Record<string, number> }
  | { choices: Record<string, Record<string, number>> }
  | { error: string };

const state = {
  calls: [] as LlamaCall[],
  script: (() => []) as (call: LlamaCall) => LlamaScript,
  releases: 0,
  gpuFailed: false,
  decideCalls: [] as DecideCall[],
  decideScript: (() => ({ scores: { rel: 2 } })) as (call: DecideCall) => DecideScript,
};

/** Every text call so far, in order. Live objects. */
export const llamaCalls = (): LlamaCall[] => state.calls;
/** How many times the context was reset. */
export const llamaReleases = (): number => state.releases;
/** Every Kev `decide()` so far, in order. */
export const decideCalls = (): DecideCall[] => state.decideCalls;

/** What Kev's decide() throws once the GPU has failed a command buffer (iOS refuses GPU work from
 *  the background). Sticky: every later decide throws it until the context is reset. */
export const KEV_GPU_FAILED = 'failed to evaluate the decision prompt (error -3)';

/** Scripts Kev's answers for the next `decide()` calls (default: score 2 for `rel`). */
export function installDecide(script: DecideScript | ((call: DecideCall) => DecideScript)): void {
  state.decideScript = typeof script === 'function' ? script : () => script;
}

const inBackground = (): boolean => testHost.appState.currentState === 'background';

const nextTick = (ms?: number) => new Promise<void>((r) => (ms ? setTimeout(r, ms) : setImmediate(r)));

function startCall(kind: LlamaCall['kind'], system: string | undefined, prompt: string, params: Record<string, unknown>) {
  const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }];
  const call: LlamaCall = { kind, messages, params, stopped: false, delivered: [] };
  state.calls.push(call);
  const raw = state.script(call);
  return { call, script: Array.isArray(raw) ? { tokens: raw } : raw };
}

async function* tokens(call: LlamaCall, s: Exclude<LlamaScript, string[]>, signal?: AbortSignal): AsyncGenerator<string> {
  const stop = () => void (call.stopped = true);
  signal?.addEventListener('abort', stop);
  try {
    for (const token of s.tokens) {
      await nextTick(s.tokenDelayMs);
      if (signal?.aborted) stop();
      if (call.stopped) return;
      call.delivered.push(token);
      yield token;
    }
    if (s.hang && signal && !signal.aborted) {
      await new Promise<void>((r) => signal.addEventListener('abort', () => r()));
      stop();
    }
    if (s.error && !call.stopped) throw nativeError(s.error);
  } finally {
    signal?.removeEventListener('abort', stop);
  }
}

async function complete(kind: LlamaCall['kind'], system: string | undefined, prompt: string, params: Record<string, unknown>) {
  const { call, script } = startCall(kind, system, prompt, params);
  for await (const _ of tokens(call, script)) {
    // delivered is recorded by the generator
  }
  return { text: call.delivered.join(''), truncated: !!script.truncated };
}

const fakeModel: OnDeviceModel = {
  async infer(params) {
    const { text, truncated } = await complete('infer', params.systemPrompt, params.prompt, params);
    return { output: text, tokensUsed: text.length, latencyMs: 0, truncated };
  },
  inferStream(params, signal) {
    const { call, script } = startCall('stream', params.systemPrompt, params.prompt, params);
    return tokens(call, script, signal);
  },
  async inferStructured<T>(params: Parameters<OnDeviceModel['inferStructured']>[0]): Promise<T> {
    const { text } = await complete('structured', params.system, params.prompt, params);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw nativeError('ERR_STRUCTURED_OUTPUT');
    }
  },
  async decide(request) {
    if (inBackground()) throw nativeError('ERR_AFM_BUSY');
    const call: DecideCall = { request: request as DecideCall['request'] };
    state.decideCalls.push(call);
    await nextTick();
    if (state.gpuFailed) throw new Error(KEV_GPU_FAILED);
    const answer = state.decideScript(call);
    // The app left during the call: the host refuses its result, whatever the model did.
    if (inBackground()) throw nativeError('ERR_AFM_BUSY');
    if ('error' in answer) {
      if (answer.error === KEV_GPU_FAILED) state.gpuFailed = true;
      throw nativeError(answer.error);
    }
    const answers: Record<string, unknown> = {};
    if ('choices' in answer) {
      for (const [id, probabilities] of Object.entries(answer.choices)) {
        const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
        answers[id] = { type: 'choice', choice, probabilities, confidence: 0.5 };
      }
    } else {
      for (const [id, score] of Object.entries(answer.scores)) answers[id] = { type: 'score', score };
    }
    return { model: 'Kev-4B', answers, usage: { input_tokens: 100, output_tokens: 0 } } as never;
  },
  async contextSize() {
    return 4096;
  },
  async resetContext() {
    state.releases += 1;
    state.gpuFailed = false;
  },
  async getTextEngine() {
    return 'afm';
  },
};

/**
 * Puts the scripted models on the test host and sets processing to on-device. `script` is fixed,
 * or a function of the call (read `call.messages` to answer by prompt). Kev's answers come from
 * `installDecide`.
 */
export function installLlama(script: LlamaScript | ((call: LlamaCall) => LlamaScript)): void {
  Object.assign(state, {
    calls: [],
    releases: 0,
    gpuFailed: false,
    decideCalls: [],
    decideScript: () => ({ scores: { rel: 2 } }),
    script: typeof script === 'function' ? script : () => script,
  });
  testHost.onDeviceModel = fakeModel;
  useMeraProtocolStore.setState({ processingMode: ProcessingMode.OnDevice });
}
