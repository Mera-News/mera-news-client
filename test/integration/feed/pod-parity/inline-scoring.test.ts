// Scoring inline on a host transport follows the same rules as scoring through the gateway's
// async jobs: the relevance prompt carries today's date and each fact's added date, so a trip
// can end. The model is a rule the test states, so each case can only pass for its reason.
import { loadSuggestions } from '@/lib/database/services/article-suggestion-reads';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
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
    useMeraProtocolStore.setState({ skipNotes: false });
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

  /** Scores each fenced article by its title: `High` titles 0.9, every other title 0.2. */
  const byTitle = (call: HostCall): string => {
    if (!call.id?.startsWith('score:')) return defaultHostResponder(call);
    return JSON.stringify([...call.prompt.matchAll(BLOCK)].map((m) => (/News Title: High/.test(m[2]) ? 0.9 : 0.2)));
  };

  // Distinct words per story, so no two read as copies of one story.
  const STORIES: Record<string, [string, string]> = {
    'High-f1': ['High-f1 Verstappen wins in Brazil', 'A late safety car decides the race.'],
    'High-gold': ['High-gold Gold reaches a record price', 'Investors leave equities after weak jobs data.'],
    'low-tennis': ['low-tennis Wimbledon raises prize money', 'Champions will receive three million pounds.'],
    'at-gate': ['at-gate McLaren signs a new driver', 'The contract runs until the end of 2029.'],
    'under-gate': ['under-gate Monza track resurfaced', 'Workers replace the asphalt before spring testing.'],
  };

  function serveStories(topics: Record<string, string[]>, headlines: string[]) {
    const served = serveHydrate({ article: (id) => art(id, { title: STORIES[id][0], title_en: STORIES[id][0], description_en: STORIES[id][1] }) });
    server.use(servePersona({ topics, headlines: [{ scope: 'GLOBAL', ids: headlines }] }), ...served.handlers);
  }

  // Fails until the inline pass admits top headlines the way the gateway's pipeline does.
  it.failing('asks the model about a top headline no fact matched, and excludes it when it scores low', async () => {
    const transport = hostTransport(byTitle);
    testHost.llmTransport = transport;
    await seedInterest('I follow Formula 1', ['formula 1']);
    serveStories({ 'formula 1': ['High-f1'] }, ['High-gold', 'low-tennis']);

    await advanceUntilDone(startMachine());

    const asked = transport.calls.filter((c) => c.id?.startsWith('score:')).map((c) => c.prompt).join('\n');
    expect(asked).toContain('News Title: High-gold');
    expect(asked).toContain('News Title: low-tennis');
    const rows = Object.fromEntries((await loadSuggestions()).map((r) => [r.articleId, r]));
    expect(rows['low-tennis'].status).toBe('excluded');
    expect(rows['High-gold'].status).toBe('complete');
    expect(rows['High-gold'].relevance).toBeGreaterThanOrEqual(0.4);
  });

  it('writes no note for a row below the 0.4 gate, and one for a row at it', async () => {
    const atGate = (call: HostCall): string => {
      if (!call.id?.startsWith('score:')) return defaultHostResponder(call);
      return JSON.stringify([...call.prompt.matchAll(BLOCK)].map((m) => (/News Title: at/.test(m[2]) ? 0.4 : 0.39)));
    };
    const transport = hostTransport(atGate);
    testHost.llmTransport = transport;
    await seedInterest('I follow Formula 1', ['formula 1']);
    serveStories({ 'formula 1': ['at-gate', 'under-gate'] }, []);

    await advanceUntilDone(startMachine());

    const notesFor = transport.calls.filter((c) => c.id?.startsWith('reason:')).map((c) => /News Title: (\S+)/.exec(c.prompt)?.[1]);
    expect(notesFor).toEqual(['at-gate']);
    const rows = Object.fromEntries((await loadSuggestions()).map((r) => [r.articleId, r]));
    expect(rows['under-gate'].status).toBe('complete');
    expect(rows['under-gate'].reason ?? '').toBe('');
    expect(rows['at-gate'].reason).not.toBe('');
  });

  it('with Skip notes on, asks for no note at all', async () => {
    useMeraProtocolStore.setState({ skipNotes: true });
    const transport = hostTransport(byTitle);
    testHost.llmTransport = transport;
    await seedInterest('I follow Formula 1', ['formula 1']);
    serveStories({ 'formula 1': ['High-f1'] }, []);

    await advanceUntilDone(startMachine());

    expect(transport.calls.filter((c) => c.id?.startsWith('reason:'))).toEqual([]);
    const [row] = await loadSuggestions();
    expect(row.status).toBe('complete');
  });
});
