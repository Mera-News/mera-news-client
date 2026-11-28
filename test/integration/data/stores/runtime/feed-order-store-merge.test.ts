// Two Feed cards whose stories later turn out to be one: nothing moves while the
// reader is in the session, and the next session shows one card. Driven by the
// real selector (buildFeedList), so grouping and ingest are checked together.
import { buildFeedList } from '@/lib/stores/feed-list-selector';
import { FEED_CARD_STATE_SETTING_KEY, FEED_ORDER_SETTING_KEY, useFeedOrderStore } from '@/lib/stores/feed-order-store';
import { getSetting } from '@/lib/database/services/setting-service';
import { ArticleSuggestionStatus } from '@/lib/database/article-suggestion-status';
import type { ForYouSuggestion } from '@/lib/stores/for-you-store';
import { useStrictClock } from '@/test/helpers';
import { drainWrites, resetStore, until } from './support';

const NOW = Date.parse('2026-10-09T10:00:00.000Z');
const H = 3_600_000;

function sugg(id: string, o: Partial<ForYouSuggestion> = {}): ForYouSuggestion {
  return {
    _id: id,
    articleId: id,
    clusters: [],
    relevance: o.relevance ?? 0.6,
    reason: o.reason ?? 'note',
    status: ArticleSuggestionStatus.Complete,
    country_code: null,
    language_code: 'en',
    publication_name: `Pub ${id}`,
    title_en: o.title_en ?? null,
    title_original: null,
    description_en: null,
    article_url: null,
    image_url: null,
    userTopicIds: [],
    createdAt: new Date(NOW - H).toISOString(),
    firstPubDate: new Date(NOW - H).toISOString(),
    rawScore: 0.5,
    eventType: null,
    headlineScope: null,
    matchedTopics: [],
    factIds: [],
    scoredAt: null,
    storyKey: o.storyKey ?? null,
  };
}

const A = sugg('a', { title_en: 'alpha bravo charlie delta', storyKey: 'k1' });
const B = sugg('b', { title_en: 'echo foxtrot golf hotel' });
// A shown arrival that shares A's story key and B's title words: one story now.
const C = sugg('c', { title_en: 'echo foxtrot golf india', storyKey: 'k1' });

const store = () => useFeedOrderStore.getState();
const list = (rows: ForYouSuggestion[]) => buildFeedList(rows, new Set(), NOW);

describe('two cards that become one story', () => {
  beforeEach(async () => {
    useStrictClock(NOW);
    resetStore(useFeedOrderStore);
    await store().hydrate([]);
  });
  afterEach(async () => {
    store().reset();
    await drainWrites();
    await until(
      async () =>
        (await getSetting(FEED_ORDER_SETTING_KEY)) === null && (await getSetting(FEED_CARD_STATE_SETTING_KEY)) === null,
      'reset to delete both rows',
    );
  });

  it('stay two cards through ingest, and collapse to one at the session boundary', () => {
    store().ingest(list([A, B]), new Set());
    expect([...store().order].sort()).toEqual(['a', 'b']);

    const merged = list([A, B, C]);
    expect(merged).toHaveLength(1);
    store().ingest(merged, new Set());
    // Mid-session: no card leaves, no card moves.
    expect([...store().order].sort()).toEqual(['a', 'b']);

    store().prune(merged);
    expect(store().order).toEqual([merged[0].id]);
  });

  it('the card that stays keeps its card state', () => {
    store().ingest(list([A, B]), new Set());
    store().markViewed('a');
    const merged = list([A, B, C]);
    store().ingest(merged, new Set());
    store().prune(merged);
    expect(store().cardStates.a?.state).toBe('viewed');
  });
});
