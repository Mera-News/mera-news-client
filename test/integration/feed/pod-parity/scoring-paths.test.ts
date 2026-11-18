// One profile and one set of articles scored twice: through Mera's gateway with async jobs, and
// through a host transport with no jobs (scoring inline through `batch`). The model is a responder
// that derives every score and note from the exact text it was sent, so a changed prompt byte on
// one path changes its scores. Both runs must send the same relevance requests (system prompt,
// person context and article text), store the same relevance and put the same stories on the Feed,
// apart from the named gateway gaps below; every Feed entry must carry a note on both.
//
// PARITY_REPORT=<file> also writes both captures and the note differences to that file.
jest.mock('@/lib/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    addBreadcrumb: jest.fn(),
  },
}));

import { createHash } from 'crypto';
import fs from 'node:fs';
import { loadSuggestions } from '@/lib/database/services/article-suggestion-reads';
import { getPipeline } from '@/lib/database/services/scoring-pipeline-store';
import { buildFeedList } from '@/lib/stores/feed-list-selector';
import {
  advanceUntilDone,
  defaultResponder,
  gatewayCalls,
  http,
  HttpResponse,
  mockGateway,
  resetDatabase,
  server,
  testHost,
  type GatewayCall,
} from '@/test/helpers';
import {
  art,
  cleanupFeedSync,
  PIPELINE_NOW,
  resetFeedSyncMemory,
  resetScoringWorld,
  seedInterest,
  seedLocation,
  serveHydrate,
  servePersona,
  tick,
  tickUntilScored,
} from '@/test/integration/data/feed-sync/steps/support';
import { settleMachine, startMachine } from '@/test/integration/data/feed-sync/machine/support';
import { hostTransport, type HostCall } from '@/test/integration/chat/transport/host-transport-kit';
import { createOpenAiTransport } from '@/lib/llm/openai-transport';

jest.setTimeout(180_000);

const BLOCK = /<<ARTICLE ([a-f0-9]{12})>>([\s\S]*?)<<\/ARTICLE \1>>/g;
const blocks = (user: string) => [...user.matchAll(BLOCK)].map((m) => m[2]);
const context = (user: string) => user.replace(BLOCK, '<<ARTICLE>>').replace(/\b\d+ numbers\b/, 'N numbers');
/** The person part of a request: everything before the first article. How articles are batched is not compared. */
const userContext = (user: string) => user.split('\n\n=====')[0];
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const titleOf = (block: string) => /News Title: (.*)/.exec(block)?.[1]?.trim() ?? '';

const ARTICLES: Record<string, { title: string; description: string; country: string | null }> = {
  f1a: { title: 'Verstappen takes pole in Abu Dhabi', description: 'Red Bull locks out the front row before the season finale.', country: 'AE' },
  f1b: { title: 'Formula 1 confirms 2027 calendar', description: 'Twenty-four races, with Madrid joining and Imola dropped.', country: null },
  msp: { title: 'MotoGP rider fined after Valencia crash', description: 'Stewards hand down a grid penalty for the next race.', country: 'ES' },
  nhs: { title: 'Dutch hospitals short of night nurses', description: 'Unions warn of burnout as winter admissions climb.', country: 'NL' },
  utr: { title: 'Rail strike halts trains across Utrecht', description: 'NS cancelled most services during the 24-hour walkout.', country: 'NL' },
  utc: { title: 'Utrecht council approves new cycle bridge', description: 'The bridge links Leidsche Rijn with the city centre.', country: 'NL' },
  gld: { title: 'Gold hits record as markets slide', description: 'Investors move to safe assets after weak jobs data.', country: 'US' },
  ten: { title: 'Wimbledon raises prize money again', description: 'Singles champions will receive three million pounds.', country: 'GB' },
  // Exactly at the feed gate and the note threshold (both 0.4, inclusive), and just under it.
  atg: { title: 'Utrecht hospital opens night clinic', description: 'The clinic takes walk-in patients after ten.', country: 'NL' },
  ung: { title: 'Grand Prix ticket prices rise', description: 'Organisers blame higher circuit costs.', country: null },
};
const FIXED_SCORE: Record<string, number> = { [ARTICLES.atg.title]: 0.4, [ARTICLES.ung.title]: 0.39 };

/** Score = a fixed function of the system prompt and the article's own fenced block. */
function score(system: string, block: string): number {
  const title = /News Title: (.*)/.exec(block)?.[1]?.trim() ?? '';
  if (title in FIXED_SCORE) return FIXED_SCORE[title];
  return Math.round((0.05 + (parseInt(sha(system + '\n' + block).slice(0, 4), 16) % 91) / 100) * 100) / 100;
}

/** The model, the same for both paths: `id` is the BatchCall id (`score:N`, `reason:<x>`). */
function answer(id: string | undefined, system: string, user: string): string | null {
  if (id?.startsWith('score:')) return JSON.stringify(blocks(user).map((b) => score(system, b)));
  if (id?.startsWith('reason:')) {
    const block = blocks(user).join('\n');
    const title = /News Title: (.*)/.exec(block)?.[1]?.trim() ?? '';
    const fact = /Related User Fact: (.*)/.exec(block)?.[1]?.trim() ?? '';
    const why = `${title}, which ties to ${fact} (${sha(system + '\n' + context(user) + block).slice(0, 8)}).`;
    return system.includes('"keep"') ? JSON.stringify({ keep: true, why }) : why;
  }
  return null;
}

const viaGateway = (call: GatewayCall) => {
  const system = call.messages.find((m) => m.role === 'system')?.content ?? '';
  const user = call.messages.find((m) => m.role === 'user')?.content ?? '';
  return answer(call.callId, system, user) ?? defaultResponder(call);
};

const viaHost = (call: HostCall) => {
  const reply = answer(call.id, call.system, call.prompt);
  if (reply !== null) return reply;
  throw new Error(`the fixture model has no answer for ${call.kind} ${call.id ?? ''} on ${call.route}`);
};

async function seedProfile() {
  await seedInterest('I follow Formula 1', ['formula 1', 'motorsport']);
  await seedInterest('Works as a nurse in Utrecht', ['dutch healthcare', 'utrecht news']);
  await seedLocation('NL', 1, 'home');
}

function serveArticles() {
  const served = serveHydrate({
    article: (id) => {
      const a = ARTICLES[id];
      return art(id, { title: a.title, title_en: a.title, description_en: a.description, country_code: a.country });
    },
  });
  server.use(
    servePersona({
      topics: {
        'formula 1': ['f1a', 'f1b', 'ung'],
        motorsport: ['msp', 'f1a'],
        'dutch healthcare': ['nhs', 'atg'],
        'utrecht news': ['utc', 'utr', 'atg'],
      },
      headlines: [
        { scope: 'GLOBAL', ids: ['gld', 'ten'] },
        { scope: 'COUNTRY', countryCode: 'NL', ids: ['nhs', 'utr'] },
      ],
    }),
    ...served.handlers,
  );
}

interface Sent {
  kind: string;
  system: string;
  article: string;
  context: string;
}

const relevanceSent = (calls: { id?: string; system: string; user: string }[]): Sent[] =>
  calls
    .filter((c) => c.id?.startsWith('score:'))
    .flatMap((c) => blocks(c.user).map((b) => ({ kind: 'score', system: sha(c.system), article: `${titleOf(b)} ${sha(b).slice(0, 12)}`, context: sha(userContext(c.user)) })))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

async function capture(sent: { id?: string; system: string; user: string }[]) {
  const suggestions = await loadSuggestions();
  const byArticle = Object.fromEntries(
    [...suggestions].sort((a, b) => a.articleId.localeCompare(b.articleId)).map((s) => [s.articleId, { status: s.status, relevance: s.relevance, rawScore: s.rawScore ?? null, reason: s.reason ?? '' }]),
  );
  const feed = buildFeedList(suggestions, new Set(), PIPELINE_NOW + 60 * 60 * 1000).map((item) => {
    const s = (item as unknown as { s?: { articleId: string } }).s;
    return s?.articleId ?? (item as unknown as { id: string }).id;
  });
  const notesAsked = sent.filter((c) => c.id?.startsWith('reason:')).map((c) => `${c.id} ${/News Title: (.*)/.exec(c.user)?.[1] ?? ''} | ${/Relevance Score: (.*)/.exec(c.user)?.[1] ?? '-'} | ${c.system.slice(0, 50)}`);
  const contexts = [...new Set(sent.filter((c) => c.id?.startsWith('score:')).map((c) => context(c.user)))];
  return { relevance: relevanceSent(sent), byArticle, feed, calls: sent.length, contexts, notesAsked };
}

async function runGatewayPath() {
  delete testHost.llmTransport;
  await seedProfile();
  serveArticles();
  server.use(...mockGateway(viaGateway));
  await advanceUntilDone(startMachine());
  await advanceUntilDone(tickUntilScored(Object.keys(ARTICLES).length));
  for (let i = 0, quiet = 0; i < 300 && quiet < 3; i += 1) {
    const before = gatewayCalls().length;
    await tick();
    const owed = (await loadSuggestions()).some((s) => s.status === 'reason_pending');
    quiet = gatewayCalls().length === before && !owed && (await getPipeline()) === null ? quiet + 1 : 0;
  }
  const sent = gatewayCalls('job').map((c) => ({
    id: c.callId,
    system: c.messages.find((m) => m.role === 'system')?.content ?? '',
    user: c.messages.find((m) => m.role === 'user')?.content ?? '',
  }));
  return capture(sent);
}

async function runHostPath() {
  const gatewayBefore = gatewayCalls().length;
  const transport = hostTransport(viaHost);
  testHost.llmTransport = transport;
  await seedProfile();
  serveArticles();
  await advanceUntilDone(startMachine());
  const sent = transport.calls.filter((c) => c.kind === 'batch').map((c) => ({ id: c.id, system: c.system, user: c.prompt }));
  return { ...(await capture(sent)), gatewayCalls: gatewayCalls().length - gatewayBefore };
}

/** The same model behind a plain OpenAI-compatible endpoint: the wire carries no call ids, so the
 *  kind of call is read from the request, as a real model would read it. */
async function runOpenAiPath() {
  const gatewayBefore = gatewayCalls().length;
  const sent: { id?: string; system: string; user: string }[] = [];
  server.use(
    http.post('http://model.test/v1/chat/completions', async ({ request }) => {
      const body = (await request.json()) as { messages: { role: string; content: string }[] };
      const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
      const id = /Return a JSON array of/.test(user) ? 'score:wire' : /Relevance Score:/.test(user) ? 'reason:wire' : undefined;
      sent.push({ id, system, user });
      const content = answer(id, system, user);
      if (content === null) return new HttpResponse('the fixture model has no answer', { status: 500 });
      return HttpResponse.json({ choices: [{ message: { content } }] });
    }),
  );
  testHost.llmTransport = createOpenAiTransport({ baseUrl: 'http://model.test/v1', model: 'fixture-model' });
  await seedProfile();
  serveArticles();
  await advanceUntilDone(startMachine());
  return { ...(await capture(sent)), gatewayCalls: gatewayCalls().length - gatewayBefore, modelRequests: sent.length };
}

describe('scoring on a host transport matches scoring through the gateway', () => {
  beforeEach(async () => {
    resetFeedSyncMemory();
    await resetScoringWorld();
  });
  afterEach(async () => {
    await settleMachine();
    cleanupFeedSync();
  });

  it('sends the same relevance requests, stores the same relevance and shows the same Feed', async () => {
    const gateway = await runGatewayPath();

    await settleMachine();
    cleanupFeedSync();
    server.resetHandlers();
    await resetDatabase();
    resetFeedSyncMemory();
    await resetScoringWorld();

    const host = await runHostPath();

    const notes = Object.keys(gateway.byArticle)
      .filter((id) => gateway.byArticle[id].reason !== host.byArticle[id]?.reason)
      .map((id) => ({ id, gateway: gateway.byArticle[id].reason, host: host.byArticle[id]?.reason ?? null }));
    if (process.env.PARITY_REPORT) fs.writeFileSync(process.env.PARITY_REPORT, JSON.stringify({ gateway, host, notes }, null, 2) + '\n');

    expect(host.gatewayCalls).toBe(0);
    expect(host.relevance).toEqual(gateway.relevance);
    const relevanceOf = (c: typeof gateway) => Object.fromEntries(Object.entries(c.byArticle).map(([id, r]) => [id, r.relevance]));
    expect(relevanceOf(host)).toEqual(relevanceOf(gateway));
    // Membership, not order: the gateway path stores no raw score, so its Feed ranks ties by age
    // and id (the case below), while the inline path ranks by the score it keeps.
    expect([...host.feed].sort()).toEqual([...gateway.feed].sort());
    for (const id of host.feed) expect(host.byArticle[id].reason).not.toBe('');
    for (const id of gateway.feed) expect(gateway.byArticle[id].reason).not.toBe('');
  });

  it('the OpenAI transport sends, stores and shows what the in-process host transport does', async () => {
    const host = await runHostPath();

    await settleMachine();
    cleanupFeedSync();
    server.resetHandlers();
    await resetDatabase();
    resetFeedSyncMemory();
    await resetScoringWorld();

    const wire = await runOpenAiPath();
    if (process.env.PARITY_REPORT) fs.writeFileSync(process.env.PARITY_REPORT, JSON.stringify({ host, wire }, null, 2) + '\n');

    expect(wire.gatewayCalls).toBe(0);
    expect(wire.relevance).toEqual(host.relevance);
    expect(wire.byArticle).toEqual(host.byArticle);
    expect(wire.feed).toEqual(host.feed);
    // One read of the ten fixture articles: two relevance requests, then one note per Feed story.
    expect(wire.modelRequests).toBe(host.calls);
    expect(wire.modelRequests).toBe(2 + wire.feed.length);
  });

  // The note gate is inclusive on both paths: a raw score of exactly 0.4 is owed a note and gets it.
  it('through the gateway, a row scored exactly at the gate gets its note', async () => {
    const gateway = await runGatewayPath();
    expect(gateway.byArticle.atg.status).toBe('complete');
  });

  // Fails until the gateway path stores the raw score the Feed ranks by.
  it.failing('through the gateway, a scored row keeps its raw score', async () => {
    const gateway = await runGatewayPath();
    expect(gateway.byArticle.f1a.rawScore).toBe(0.87);
  });
});
