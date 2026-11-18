// Scoring inline on a host transport follows the same rules as scoring through the gateway's
// async jobs: the relevance prompt carries today's date and each fact's added date, so a trip
// can end. The model is a rule the test states, so each case can only pass for its reason.
import { loadSuggestions } from '@/lib/database/services/article-suggestion-reads';
import { advanceUntilDone, server, testHost } from '@/test/helpers';
import {
  art,
  cleanupFeedSync,
  PIPELINE_NOW,
  resetFeedSyncMemory,
  resetScoringWorld,
  seedInterest,
  serveHydrate,
  servePersona,
} from '@/test/integration/data/feed-sync/steps/support';
import { settleMachine, startMachine } from '@/test/integration/data/feed-sync/machine/support';
import { defaultHostResponder, hostTransport, type HostCall } from '@/test/integration/chat/transport/host-transport-kit';

jest.setTimeout(60_000);

const BLOCK = /<<ARTICLE ([a-f0-9]{12})>>([\s\S]*?)<<\/ARTICLE \1>>/g;
const DAY = 24 * 60 * 60 * 1000;

/** A trip is over once the prompt's today is past the trip's end date: its city's news scores low. */
function tripModel(call: HostCall): string {
  if (!call.id?.startsWith('score:')) return defaultHostResponder(call);
  const today = /Today: (\d{4}-\d{2}-\d{2})/.exec(call.prompt)?.[1];
  const tripEnd = /Visiting Lisbon until (\d{4}-\d{2}-\d{2})/.exec(call.prompt)?.[1];
  const over = today !== undefined && tripEnd !== undefined && today > tripEnd;
  const scores = [...call.prompt.matchAll(BLOCK)].map((m) => (/Lisbon/.test(m[2]) && over ? 0.1 : 0.9));
  return JSON.stringify(scores);
}

describe('inline scoring on a host transport', () => {
  beforeEach(async () => {
    resetFeedSyncMemory();
    await resetScoringWorld();
  });
  afterEach(async () => {
    await settleMachine();
    cleanupFeedSync();
  });

  it('sends today and the added date, so a trip that ended stops matching', async () => {
    const transport = hostTransport(tripModel);
    testHost.llmTransport = transport;
    jest.setSystemTime(PIPELINE_NOW - 10 * DAY);
    await seedInterest('Visiting Lisbon until 2026-10-05', ['lisbon news']);
    jest.setSystemTime(PIPELINE_NOW);
    const served = serveHydrate({ article: (id) => art(id, { title: `Lisbon tram strike ${id}`, title_en: `Lisbon tram strike ${id}`, description_en: 'Trams stop across Lisbon.' }) });
    server.use(servePersona({ topics: { 'lisbon news': ['l1'] } }), ...served.handlers);

    await advanceUntilDone(startMachine());

    const prompt = transport.calls.find((c) => c.id?.startsWith('score:'))?.prompt ?? '';
    expect(prompt).toMatch(/^User Context: Today: 2026-10-09\n/);
    expect(prompt).toContain('Visiting Lisbon until 2026-10-05 (added 2026-09-29)');
    const [row] = await loadSuggestions();
    expect(row.relevance).toBeLessThan(0.4);
  });
});
