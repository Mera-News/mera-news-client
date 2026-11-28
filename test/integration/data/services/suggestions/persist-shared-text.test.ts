// A followed-story topic and a fact topic with the same words: retrieval keeps the heavier one, so the
// row is matched under an id that owns no fact. The row must still link to the fact by the shared text.
import { getUnscoredSuggestionsWithFacts } from '@/lib/database/services/article-suggestion-reads';
import { createTopics } from '@/lib/database/services/topic-service';
import { isScorableCandidate } from '@/lib/news-harness/article-pipeline/scoring';
import { buildRelevanceCalls } from '@/lib/mera-protocol/scoring-service';
import { addFact } from '@/lib/database/services/fact-service';
import { article, factsOf, freezeClock, interest, matched, seed } from './support';

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

beforeEach(() => freezeClock());
afterEach(() => jest.restoreAllMocks());

async function trackedTopic(text: string) {
  const [t] = await createTopics([{ factId: null, text, weight: 0.85, highPriority: false, provenance: 'tracked' }]);
  return t;
}

describe('a followed story with the same words as a fact topic', () => {
  it('links the row to the fact, keeps it scorable and keeps the representative id', async () => {
    const { fact } = await interest('I follow harbours', ['harbour works']);
    const tracked = await trackedTopic('Harbour  Works');

    await seed([article('a1')], { topics: { a1: [matched(tracked)] } });

    expect(await factsOf('a1')).toEqual([fact.id]);
    const [cand] = await getUnscoredSuggestionsWithFacts();
    expect(isScorableCandidate(cand)).toBe(true);
  });

  it('gives the same candidate and the same scoring bundle as matching the fact topic itself', async () => {
    const { fact, topics } = await interest('I follow harbours', ['harbour works']);
    const tracked = await trackedTopic('harbour works');

    await seed([article('via-tracked')], { topics: { 'via-tracked': [matched(tracked)] } });
    await seed([article('via-fact')], { topics: { 'via-fact': [matched(topics[0])] } });

    const cands = await getUnscoredSuggestionsWithFacts();
    const a = cands.find((c) => c.id === 'via-tracked')!;
    const b = cands.find((c) => c.id === 'via-fact')!;
    expect(a.relatedFacts).toEqual(b.relatedFacts);
    expect(a.relatedFacts.map((f) => f.id)).toEqual([fact.id]);

    // Same article text under both ids so the bundles are comparable byte for byte.
    jest.spyOn(Math, 'random').mockReturnValue(0.5); // the prompt fence nonce
    const swap = (c: typeof a) => ({ ...c, id: 'same' });
    const bundleA = await buildRelevanceCalls([swap(a)]);
    const bundleB = await buildRelevanceCalls([swap({ ...b, titleEn: a.titleEn, descriptionEn: a.descriptionEn })]);
    expect(bundleA.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(bundleA.calls)).toBe(JSON.stringify(bundleB.calls));
  });

  it('writes one link when a fact has two matching topics', async () => {
    const fact = await addFact('I follow harbours');
    const [x, y] = await createTopics([
      { factId: fact.id, text: 'x', weight: 0.75, highPriority: false, provenance: 'llm' },
      { factId: fact.id, text: 'y', weight: 0.75, highPriority: false, provenance: 'llm' },
    ]);

    const res = await seed([article('a1')], { topics: { a1: [matched(x), matched(y)] } });

    expect(res.linkedCount).toBe(1);
    expect(await factsOf('a1')).toEqual([fact.id]);
  });
});
