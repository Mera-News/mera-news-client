// A model transport a host brings (`testHost.llmTransport`), answering in process. Not a test file.
//
// It answers like the gateway mock's default responder unless a test passes its own, and records
// every call, so a test can assert what reached the model without any network.
import type { LlmTransport } from '@/lib/llm/cloudComplete';
import { defaultResponder, type GatewayCall } from '@/test/helpers';

export interface HostCall {
  kind: 'complete' | 'batch' | 'chat';
  /** The BatchCall id on a batch item (`score:N`, `reason:N`); unset otherwise. */
  id?: string;
  route: string;
  system: string;
  prompt: string;
}

export type HostResponder = (call: HostCall) => string;

/** A note the client keeps: it names the article and the fact it ties to. */
function groundedNote(call: HostCall): string {
  const title = /News Title: (.*)/.exec(call.prompt)?.[1]?.trim() ?? '';
  const fact = /Related User Fact: (.*)/.exec(call.prompt)?.[1]?.trim() ?? '';
  const why = `${title}, which ties to ${fact}.`;
  return call.system.includes('"keep"') ? JSON.stringify({ keep: true, why }) : why;
}

/** The gateway mock's default answers, for a call that never went through the gateway. */
export const defaultHostResponder: HostResponder = (call) => {
  if (call.id?.startsWith('reason:')) return groundedNote(call);
  const reply = defaultResponder({
    route: call.kind === 'batch' ? 'batch' : 'chat',
    model: 'host-model',
    stream: false,
    algo: 'ed25519',
    messages: [
      { role: 'system', content: call.system },
      { role: 'user', content: call.prompt },
    ],
    callId: call.id,
    headers: {},
    index: 0,
    aborted: false,
  } as GatewayCall);
  if (typeof reply === 'string') return reply;
  if ('chunks' in reply) return reply.chunks.join('');
  throw Object.assign(new Error(`host model failed: ${reply.status}`), { statusCode: reply.status });
};

export interface HostTransport extends LlmTransport {
  calls: HostCall[];
}

/** A transport with no async jobs that answers every call with `respond`. */
export function hostTransport(respond: HostResponder = defaultHostResponder): HostTransport {
  const calls: HostCall[] = [];
  const answer = (call: HostCall) => {
    calls.push(call);
    return respond(call);
  };
  return {
    asyncJobs: false,
    calls,
    async complete(request) {
      return answer({ kind: 'complete', route: request.route ?? 'background', system: request.systemPrompt, prompt: request.prompt });
    },
    async batch(items, route) {
      return items.map((item) => {
        try {
          return { id: item.id, output: answer({ kind: 'batch', id: item.id, route, system: item.system, prompt: item.prompt }) };
        } catch (err) {
          return { id: item.id, output: '', error: String(err) };
        }
      });
    },
    async *chat(request) {
      const system = request.messages.find((m) => m.role === 'system')?.content ?? request.system ?? '';
      const prompt = request.messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n');
      yield { type: 'text-delta', delta: answer({ kind: 'chat', route: request.route ?? 'chat-tools', system, prompt }) };
      yield { type: 'finish', reason: 'stop' };
    },
  };
}
