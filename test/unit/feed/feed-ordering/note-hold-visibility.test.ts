// A row whose copied note was rejected waits off the Feed for its own note, and
// a row whose note failed for good is listed under Discarded.

import { clearNoteHolds, holdForOwnNote, isNoteHeld, releaseNoteHold } from '@/lib/feed-ordering/note-hold';
import { buildFeedList } from '@/lib/stores/feed-list-selector';
import { buildDiscardedStories } from '@/lib/feed-ordering/not-read-tail';
import { ArticleSuggestionStatus } from '@/lib/database/article-suggestion-status';
import type { ForYouSuggestion } from '@/lib/stores/for-you-store';

const NOW = 1_000_000_000_000;
const H = 3_600_000;

function sugg(id: string, o: Partial<ForYouSuggestion> = {}): ForYouSuggestion {
  return {
    _id: id,
    articleId: id,
    clusters: [],
    relevance: o.relevance ?? 0.6,
    reason: o.reason ?? '',
    status: o.status ?? ArticleSuggestionStatus.ReasonPending,
    country_code: null,
    language_code: 'en',
    publication_name: `Pub ${id}`,
    title_en: o.title_en ?? `title ${id} unique${id}`,
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

const feedIds = (rows: ForYouSuggestion[]) =>
  buildFeedList(rows, new Set(), NOW, null, { includeReasonPending: true }).map((it) => it.id).sort();

afterEach(() => clearNoteHolds());

describe('a held row waits off the Feed for its own note', () => {
  it('a held pending row is left out, its unheld twin shows', () => {
    holdForOwnNote(['held']);
    expect(feedIds([sugg('held'), sugg('plain')])).toEqual(['plain']);
  });

  it('comes back once released', () => {
    holdForOwnNote(['held']);
    releaseNoteHold(['held']);
    expect(feedIds([sugg('held')])).toEqual(['held']);
  });

  it('holds only the pending state: a complete row with its own note shows', () => {
    holdForOwnNote(['held']);
    expect(feedIds([sugg('held', { status: ArticleSuggestionStatus.Complete, reason: 'own note' })])).toEqual([
      'held',
    ]);
  });

  it('clearNoteHolds drops every hold', () => {
    holdForOwnNote(['a', 'b']);
    clearNoteHolds();
    expect(isNoteHeld('a') || isNoteHeld('b')).toBe(false);
  });
});

describe('a note that failed for good is Discarded', () => {
  it('a reason_skipped row at 0.6 with no shown story is listed', () => {
    const skipped = sugg('skipped', { status: ArticleSuggestionStatus.ReasonSkipped });
    expect(buildDiscardedStories([skipped], null, NOW).rows.map((it) => it.id)).toEqual(['skipped']);
  });

  it('a reason_skipped copy of a shown story is attached behind that card, not listed', () => {
    const shown = sugg('shown', { status: ArticleSuggestionStatus.Complete, reason: 'note', storyKey: 'k' });
    const skipped = sugg('skipped', { status: ArticleSuggestionStatus.ReasonSkipped, storyKey: 'k' });
    const feed = buildFeedList([shown, skipped], new Set(), NOW);
    expect(feed).toHaveLength(1);
    expect(feed[0].memberIds).toEqual(['shown', 'skipped']);
    expect(feed[0].suggestion._id).toBe('shown');
    expect(buildDiscardedStories([shown, skipped], null, NOW).rows).toEqual([]);
  });
});
