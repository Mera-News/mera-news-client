// The publication reading score on article_suggestions: persisted at insert, shown on both read
// projections, and refreshed on an existing row only by a valid incoming score.
import { getGroupingRowsByIds, loadSuggestions } from '@/lib/database/services/article-suggestion-reads';
import { article, freezeClock, seed } from './support';

beforeEach(() => freezeClock());

const withScore = (id: string, readingScore: unknown) => article(id, { readingScore } as never);

async function projections(id: string) {
  const [full] = (await loadSuggestions()).filter((s) => s._id === id);
  const [grouping] = await getGroupingRowsByIds([id]);
  return [full.readingScore, grouping.readingScore];
}

describe('reading score persistence', () => {
  it('carries a valid score on both projections', async () => {
    await seed([withScore('a', 82)]);
    expect(await projections('a')).toEqual([82, 82]);
  });

  it('keeps a score of 0 as 0, not null', async () => {
    await seed([withScore('a', 0)]);
    expect(await projections('a')).toEqual([0, 0]);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['a string', '82'],
    ['NaN', NaN],
  ])('reads %s as null', async (_label, value) => {
    await seed([withScore('a', value)]);
    expect(await projections('a')).toEqual([null, null]);
  });

  it('fills a null score, keeps it on an absent one and replaces it on a new one', async () => {
    await seed([withScore('a', undefined)]);
    expect(await projections('a')).toEqual([null, null]);

    await seed([withScore('a', 70)]);
    expect(await projections('a')).toEqual([70, 70]);

    await seed([withScore('a', undefined)]);
    expect(await projections('a')).toEqual([70, 70]);

    await seed([withScore('a', 90)]);
    expect(await projections('a')).toEqual([90, 90]);
  });
});
