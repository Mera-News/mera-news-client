// A single-shot reply's short opening line is not written while the stream runs: with a tool call
// behind it, the line reaches the thread together with the tool's result, never ahead of it.
import { useCloudChatStore } from '@/lib/stores/cloud-chat-store';
import { advanceUntil, mockGateway, server, useStrictClock } from '@/test/helpers';
import { reply, resetChatModules, toolCall } from '@/test/integration/chat/_helpers';
import { attachCloud, busy, noteAgent, settle } from './kit';

jest.setTimeout(60_000);

let executed: { name: string; input: unknown }[];

beforeEach(async () => {
  resetChatModules();
  useStrictClock('2026-10-09T12:00:00Z');
  executed = [];
});
afterEach(async () => {
  jest.useRealTimers();
  await settle();
});

/** Every state the first assistant row passed through: its text, and whether its tool calls had all settled. */
function watchFirstAssistantRow() {
  const seen: { content: string; settled: boolean }[] = [];
  const stop = useCloudChatStore.subscribe((s) => {
    const row = s.messages.find((m) => m.role === 'assistant');
    if (!row) return;
    const calls = row.toolCalls ?? [];
    seen.push({ content: row.content, settled: calls.length > 0 && calls.every((c) => c.status !== 'pending') });
  });
  return { seen, stop };
}

describe('a short opening line ahead of a tool call', () => {
  it('lands with the tool result, never before it', async () => {
    server.use(
      ...mockGateway((c) => (c.index === 0 ? reply('Saving that for you.', toolCall('recordNote', { note: 'milk' })) : 'Done.')),
    );
    const { engine } = await attachCloud(noteAgent(executed));
    const watch = watchFirstAssistantRow();

    engine.send('Save my note');
    await advanceUntil(() => !busy(), 60_000);
    watch.stop();

    expect(executed).toHaveLength(1);
    expect(watch.seen.some((s) => s.content.includes('Saving that for you.'))).toBe(true);
    for (const s of watch.seen) if (s.content.trim()) expect(s.settled).toBe(true);
  });

  it('with no tool call it is written once, whole, when the stream ends', async () => {
    server.use(...mockGateway(() => ({ chunks: ['A short ', 'answer.'] })));
    const { engine } = await attachCloud(noteAgent(executed));
    const watch = watchFirstAssistantRow();

    engine.send('Hello');
    await advanceUntil(() => !busy(), 60_000);
    watch.stop();

    expect([...new Set(watch.seen.map((s) => s.content))]).toEqual(['', 'A short answer.']);
  });
});
