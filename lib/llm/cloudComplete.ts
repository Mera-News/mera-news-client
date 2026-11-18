// cloudComplete — cloud LLM completion, batch completion, and streaming chat: the three calls
// every caller makes, and their request types. Each one hands the call to the transport
// (LlmTransport below): the host's own when it brings one, else Mera's inference gateway
// (gateway-transport.ts), where the router, the profiles, the rate limiter, end-to-end encryption
// and the async jobs live.

import type { CloudPurpose } from './on-device-gate';
import type { BatchCall, ToolDefinition } from './types';
import type { PhaseSignal } from '@/lib/services/chat-phase';
import type { CloudCallOptions } from './gateway-fetch';
import type { Lane } from './router';
import type { SseEvent } from './chat-response';
import { gatewayTransport } from './gateway-transport';
import { platform } from '@/lib/platform';

// Everything that moved out is re-exported, so this module's export list is unchanged.
export {
  authFetch,
  CallerAbortError,
  CleartextToolCallError,
  isAbortLike,
  isCallerAbort,
  MAX_ATTEMPTS,
  RateLimitedError,
  retryAfterMsFrom,
  StreamIdleError,
  takeStreamHandle,
  UPSTREAM_ALIGNED_TIMEOUT_MS,
  type AuthFetchOptions,
  type CloudCallOptions,
} from './gateway-fetch';
export { STREAM_IDLE_TIMEOUT_MS, type SseEvent } from './chat-response';

// Canonical home is now lib/news-harness/core/types.ts; re-exported here so
// importers of BatchCompletionResult from this module keep working.
import type { BatchCompletionResult } from '@/lib/news-harness/core/types';
export type { BatchCompletionResult };

/**
 * Where a cloud model call goes. A transport takes the call whole: it picks the model for the
 * lane, sends, retries and reads the answer. Every implementation calls `assertCloudAllowed`
 * first, so on-device mode never reaches a cloud model. Errors keep the shapes callers already
 * handle (CallerAbortError, LaneExhaustedError, `statusCode` on an HTTP failure).
 */
export interface LlmTransport {
  /** One buffered completion; the reply text. */
  complete(request: CloudCompleteRequest, options: CloudCallOptions): Promise<string>;
  /** Many completions, results in item order; an item's own failure stays on its row. */
  batch(calls: BatchCall[], route: Lane, options: CloudCallOptions): Promise<BatchCompletionResult[]>;
  /** One chat leg as events. Nothing runs until the first `next()`. */
  chat(request: CloudChatStreamRequest): AsyncGenerator<SseEvent>;
  /** False: this transport cannot run the gateway's async jobs, so scoring calls `batch` inline. */
  asyncJobs?: false;
}

/** The host's transport when it brings one, else Mera's gateway. Read at every call. */
function transport(): LlmTransport {
  return platform('llm-transport').llmTransport ?? gatewayTransport;
}

/** Whether scoring may submit async inference jobs to the active transport. */
export function transportServesJobs(): boolean {
  return transport().asyncJobs !== false;
}

export interface CloudCompleteRequest {
  systemPrompt: string;
  prompt: string;
  /** Which lane's profiles serve this call. Default 'background'. */
  route?: Lane;
  maxTokens?: number;
  maxCompletionTokens?: number;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  /** 'chat' only for a call made inside a chat (quick fact check, readiness ping):
   *  it then runs on device while cloud chat is on. Omitted means background. */
  purpose?: CloudPurpose;
}

/** Single completion call. Served by `request.route`'s profiles, in the router's order. */
export function cloudComplete(
  request: CloudCompleteRequest,
  options: CloudCallOptions = {},
): Promise<string> {
  return transport().complete(request, options);
}

/** Batch completion: many calls in one request where the transport can, results in item order. */
export function cloudBatchComplete(
  calls: BatchCall[],
  route: Lane = 'background',
  options: CloudCallOptions = {},
): Promise<BatchCompletionResult[]> {
  return transport().batch(calls, route, options);
}

// ---------------------------------------------------------------------------
// Wire types for OpenAI-format messages
// ---------------------------------------------------------------------------

export interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface CloudChatStreamRequest {
  messages: WireMessage[];
  /** Defaults to FALSE (owner decision 2026-10-22, every chat call). Measured:
   *  thinking off kept the single-shot pass rate on Qwen3.8 (30/32 vs 30/32) and
   *  cut article-chat turns from p50 15s to 2.4s. A caller that needs the trace
   *  passes true and gets CHAT_REASONING_HEADROOM_TOKENS on top. */
  enableThinking?: boolean;
  /** Defaults to TRUE. FALSE for a step nobody watches arrive: the answer is
   *  then ONE envelope, one decrypt, instead of one ECDH per token. Tool calls
   *  travel inside the content now, so a streamed tool step decrypts every
   *  token of its arguments, which native tool calls never cost. */
  stream?: boolean;
  tools?: ToolDefinition[];
  system?: string;
  /** Which lane's profiles serve this call. Default 'chat-tools'. */
  route?: Lane;
  toolChoice?: string;
  temperature?: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  topP?: number;
  n?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  /**
   * Progress for the chat wait line. Optional, so every existing caller is
   * byte-identical and `prewarm` stays silent by simply not passing it.
   *
   * NOT AN `SseEvent`, AND IT CANNOT BE ONE. Every phase worth naming happens
   * before this generator's first yield, inside `buildChatRequest` ->
   * `sendToProfile`, neither of which can yield here.
   * In-band events would have to be buffered and flushed in a burst at the
   * exact moment they stopped being true, which is worse than no line at all.
   *
   * PER REQUEST, never a module-level emitter: prewarm, the background lane
   * and a 429 pause all drive this file, and a bus would let any of them
   * narrate a turn a person is watching.
   */
  onPhase?: (signal: PhaseSignal) => void;
  /** The caller's stop (the Stop button). Aborts the request in flight and
   *  cancels the body mid-stream; surfaces as a CallerAbortError. */
  signal?: AbortSignal;
}

/** Streaming chat: one leg of a chat turn as events (see the gateway transport for the detail). */
export function cloudChatStream(request: CloudChatStreamRequest): AsyncGenerator<SseEvent> {
  return transport().chat(request);
}
