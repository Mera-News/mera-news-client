// The read hold is the gateway's daily quota. It is checked on the job paths (submit, enqueue, the
// reasons submit), not in the inline scorer. A host's own endpoint is not under that quota, so a
// held device that brings a transport still scores inline. On the gateway, a hold must also keep the
// outage fallback from running an inline pass in its place.
import { loadSuggestions } from '@/lib/database/services/article-suggestion-reads';
import { ArticleSuggestionStatus } from '@/lib/database/article-suggestion-status';
import { PROFILES } from '@/lib/llm/profiles';
import { reportProfileFailure } from '@/lib/llm/router';
import * as scoringPipeline from '@/lib/services/scoring-pipeline';
import { isReadHeld, resetReadHold, setReadHold } from '@/lib/subscription/read-hold';
import { advanceUntilDone, attestationRequests, gatewayCalls, http, HttpResponse, server, setAppState, testHost } from '@/test/helpers';
import { hostTransport } from '@/test/integration/chat/transport/host-transport-kit';
import { serveRedPill } from '@/test/integration/chat/transport/transport-kit';
import { art, cleanupFeedSync, resetFeedSyncMemory, resetScoringWorld, seedInterest, serveHydrate, servePersona } from '@/test/integration/data/feed-sync/steps/support';
import { settleMachine, startMachine } from '@/test/integration/data/feed-sync/machine/support';
import { cleanupWorld, drive, gateway, ids, passTime, resetPipelineWorld, rows, seedAndEnqueue } from '@/test/integration/persona/scoring-pipeline-kit';

jest.setTimeout(60_000);

const HOUR = 3_600_000;

describe('a held device on a host transport', () => {
  beforeEach(async () => {
    resetFeedSyncMemory();
    await resetScoringWorld();
    resetReadHold();
  });
  afterEach(async () => {
    await settleMachine();
    cleanupFeedSync();
    resetReadHold();
  });

  it('scores inline while the hold is set, and calls no gateway', async () => {
    const transport = hostTransport();
    testHost.llmTransport = transport;
    await seedInterest('I follow Formula 1', ['formula 1']);
    const served = serveHydrate({ article: (id) => art(id, { title: `Story ${id}`, title_en: `Story ${id}`, description_en: `About ${id}.` }) });
    server.use(servePersona({ topics: { 'formula 1': ['h1', 'h2', 'h3'] } }), ...served.handlers);
    await setReadHold({ resetAt: Date.now() + 2 * HOUR, used: 1 });
    expect(isReadHeld()).toBe(true);

    await advanceUntilDone(startMachine());

    const scored = (await loadSuggestions()).filter((r) => r.status !== 'unscored');
    expect(scored.length).toBe(3);
    expect(transport.calls.some((c) => c.kind === 'batch' && c.id?.startsWith('score:'))).toBe(true);
    expect(gatewayCalls()).toEqual([]);
    expect(attestationRequests()).toBe(0);
  });
});

describe('a held device on the gateway', () => {
  beforeEach(async () => {
    await resetPipelineWorld();
    resetReadHold();
  });
  afterEach(async () => {
    resetReadHold();
    await cleanupWorld();
  });

  it('runs no inline pass on the sync-only profile while the hold is set', async () => {
    gateway();
    const Q36 = 'Qwen/Qwen3.6-35B-A3B-FP8';
    server.use(
      http.get('*/api/attestation/report', ({ request }) => {
        const model = new URL(request.url).searchParams.get('model') ?? '';
        return [Q36, 'Qwen/Qwen3.8-27B'].includes(model) ? new HttpResponse('down', { status: 503 }) : undefined;
      }),
    );
    for (const id of ['near/qwen3.6-35b-a3b', 'near/qwen3.8-27b'] as const) {
      reportProfileFailure(PROFILES[id], 'scoring', 'attestation');
    }
    const redpill = serveRedPill(() => JSON.stringify([0.9]));
    setAppState('active');
    await setReadHold({ resetAt: Date.now() + 2 * HOUR, used: 1 });
    expect(isReadHeld()).toBe(true);

    await seedAndEnqueue(ids(6), { flush: true });
    await drive(scoringPipeline.enqueueCandidates(ids(6), true));
    await passTime(30_000);

    expect(redpill).toHaveLength(0);
    expect(gatewayCalls()).toEqual([]);
    expect(Object.values(await rows()).every((r) => r.status === ArticleSuggestionStatus.Unscored)).toBe(true);
  });
});
