// A host that brings its own model transport (`llmTransport`) with no async jobs: every model call
// the client makes goes there, scoring runs inline through `batch`, and nothing reaches Mera's
// gateway: after every test the gateway mock must have seen no call and no attestation fetch.
import { cloudBatchComplete, cloudChatStream, cloudComplete, transportServesJobs } from '@/lib/llm/cloudComplete';
import { commitFactChoices } from '@/lib/chat-tools/fact-commit';
import { deleteFact, getTopicsStatus } from '@/lib/database/services/fact-service';
import { getByFact } from '@/lib/database/services/topic-service';
import { loadSuggestions } from '@/lib/database/services/article-suggestion-reads';
import { inferenceQueue } from '@/lib/inference/InferenceQueue';
import { processAllUnscored } from '@/lib/mera-protocol/scoring-service';
import { advanceUntilDone, attestationRequests, gatewayCalls, server, testHost } from '@/test/helpers';
import { resetChatModules, setProcessingMode } from '@/test/integration/chat/_helpers';
import { pollUntil } from '@/test/integration/chat/tools/facts/kit';
import {
  art,
  cleanupFeedSync,
  resetFeedSyncMemory,
  resetScoringWorld,
  seedInterest,
  serveHydrate,
  servePersona,
} from '@/test/integration/data/feed-sync/steps/support';
import { settleMachine, startMachine } from '@/test/integration/data/feed-sync/machine/support';
import { defaultHostResponder, hostTransport, type HostResponder } from './host-transport-kit';

jest.setTimeout(60_000);

afterEach(() => {
  expect(gatewayCalls()).toEqual([]);
  expect(attestationRequests()).toBe(0);
});

describe('a host transport', () => {
  it('serves complete, batch and chat, and says it has no async jobs', async () => {
    expect(transportServesJobs()).toBe(true);
    const transport = hostTransport(() => 'host answer');
    testHost.llmTransport = transport;
    expect(transportServesJobs()).toBe(false);

    expect(await cloudComplete({ systemPrompt: 's', prompt: 'p', route: 'topics' })).toBe('host answer');
    expect(await cloudBatchComplete([{ id: 'a', system: 's', prompt: 'p' }], 'scoring')).toEqual([{ id: 'a', output: 'host answer' }]);
    const events = [];
    for await (const event of cloudChatStream({ messages: [{ role: 'user', content: 'hi' }] })) events.push(event);
    expect(events[0]).toEqual({ type: 'text-delta', delta: 'host answer' });

    expect(transport.calls.map((c) => [c.kind, c.route])).toEqual([
      ['complete', 'topics'],
      ['batch', 'scoring'],
      ['chat', 'chat-tools'],
    ]);
  });

  it('a host transport that leaves asyncJobs unset still serves async jobs', () => {
    const { asyncJobs: _drop, ...withJobs } = hostTransport();
    testHost.llmTransport = withJobs;
    expect(transportServesJobs()).toBe(true);
  });
});

describe('profile edits on a host transport', () => {
  beforeEach(async () => {
    resetChatModules();
    await setProcessingMode('cloud');
    await inferenceQueue.stop();
  });
  afterEach(async () => {
    await inferenceQueue.stop();
  });

  it('a saved fact gets its topics from the host transport, and removing it makes no model call', async () => {
    const transport = hostTransport();
    testHost.llmTransport = transport;

    const { savedFacts } = await commitFactChoices([{ statement: 'Plays chess' }]);
    await inferenceQueue.start();
    const id = savedFacts[0].id;
    expect(await pollUntil(() => getTopicsStatus(id), (s) => s === 'done')).toBe('done');
    expect((await getByFact(id)).length).toBeGreaterThan(0);
    expect(transport.calls.some((c) => c.kind === 'complete' && c.route === 'topics')).toBe(true);

    const before = transport.calls.length;
    await deleteFact(id);
    expect(transport.calls.length).toBe(before);
  });
});

describe('a feed sync on a host transport', () => {
  beforeEach(async () => {
    resetFeedSyncMemory();
    await resetScoringWorld();
  });
  afterEach(async () => {
    await settleMachine();
    cleanupFeedSync();
  });

  function serveArticles(ids: string[]) {
    const served = serveHydrate({ article: (id) => art(id, { title: `Story ${id}`, title_en: `Story ${id}`, description_en: `About ${id}.` }) });
    server.use(servePersona({ topics: { 'formula 1': ids } }), ...served.handlers);
  }

  it('scores every row inline through batch, writes the notes, and submits no job', async () => {
    const transport = hostTransport();
    testHost.llmTransport = transport;
    await seedInterest('I follow Formula 1', ['formula 1']);
    serveArticles(['a1', 'a2', 'a3']);

    await advanceUntilDone(startMachine());

    const rows = await loadSuggestions();
    expect(rows.map((r) => r.status).sort()).not.toContain('unscored');
    expect(rows.some((r) => r.status === 'reason_pending')).toBe(false);
    expect(rows.every((r) => (r.reason ?? '').length > 0)).toBe(true);
    expect(transport.calls.some((c) => c.kind === 'batch' && c.id?.startsWith('score:'))).toBe(true);
  });

  it('a note that failed is written by the next pass even with nothing left to score', async () => {
    let notesFail = true;
    const respond: HostResponder = (call) => {
      if (notesFail && call.id?.startsWith('reason:')) throw new Error('model down');
      return defaultHostResponder(call);
    };
    testHost.llmTransport = hostTransport(respond);
    await seedInterest('I follow Formula 1', ['formula 1']);
    serveArticles(['b1', 'b2']);

    await advanceUntilDone(startMachine());
    expect((await loadSuggestions()).some((r) => r.status === 'reason_pending')).toBe(true);

    notesFail = false;
    await advanceUntilDone(processAllUnscored());
    expect((await loadSuggestions()).some((r) => r.status === 'reason_pending')).toBe(false);
  });
});
