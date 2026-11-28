// A copy Mera scored below the gate joins the Feed card of its story, at most
// one card, and never joins two cards into one.

import {
  attachToGroups,
  buildStoryGroups,
  DISPLAY_GROUPING_OPTIONS,
  groupableOf,
  type GroupableItem,
} from '@/lib/algorithms/story-grouping';
import { buildFeedList } from '@/lib/stores/feed-list-selector';
import { buildDiscardedStories, foldNotReadTail, newNotReadTailSession } from '@/lib/feed-ordering/not-read-tail';
import { ArticleSuggestionStatus } from '@/lib/database/article-suggestion-status';
import type { ForYouSuggestion } from '@/lib/stores/for-you-store';

const NOW = 1_000_000_000_000;
const H = 3_600_000;

function sugg(id: string, o: Partial<ForYouSuggestion> = {}): ForYouSuggestion {
  return {
    _id: id,
    articleId: id,
    clusters: o.clusters ?? [],
    relevance: o.relevance ?? 0.6,
    reason: o.reason ?? 'because',
    status: o.status ?? ArticleSuggestionStatus.Complete,
    country_code: null,
    language_code: 'en',
    publication_name: o.publication_name ?? `Pub ${id}`,
    title_en: o.title_en ?? null,
    title_original: null,
    description_en: null,
    article_url: null,
    image_url: null,
    userTopicIds: [],
    createdAt: new Date(NOW - H).toISOString(),
    firstPubDate: o.firstPubDate ?? new Date(NOW - H).toISOString(),
    rawScore: o.rawScore ?? 0.5,
    eventType: null,
    headlineScope: null,
    matchedTopics: [],
    factIds: [],
    scoredAt: null,
    storyKey: o.storyKey ?? null,
  };
}

const below = (id: string, o: Partial<ForYouSuggestion> = {}) => sugg(id, { relevance: 0.2, reason: '', ...o });

// Jaccard(A, C) = Jaccard(B, C) = 3/7, Jaccard(A, B) = 0.
const A = sugg('a', { title_en: 'alpha bravo charlie delta' });
const B = sugg('b', { title_en: 'echo foxtrot golf hotel' });
const BRIDGE = below('c', { title_en: 'alpha bravo charlie echo foxtrot golf' });
// Jaccard(A, D) = 3/5, no edge to B.
const COPY = below('d', { title_en: 'alpha bravo charlie kilo', rawScore: 1.2 });

function byId(list: ReturnType<typeof buildFeedList>, id: string) {
  return list.find((it) => it.id === id);
}

describe('attaching below-gate copies to Feed cards', () => {
  it('a copy that bridges two shown stories joins neither, and they stay two cards', () => {
    const list = buildFeedList([A, B, BRIDGE], new Set(), NOW);
    expect(list.map((it) => it.id).sort()).toEqual(['a', 'b']);
    expect(byId(list, 'a')?.memberCount).toBe(1);
    expect(byId(list, 'b')?.memberCount).toBe(1);
  });

  it('a copy of one shown story joins that card, counted and listed but never fronting', () => {
    const list = buildFeedList([A, B, COPY], new Set(), NOW);
    expect(list).toHaveLength(2);
    const a = byId(list, 'a')!;
    expect(a.memberCount).toBe(2);
    expect(a.attachedCount).toBe(1);
    expect(a.memberIds).toEqual(['a', 'd']);
    expect(a.suggestion._id).toBe('a');
    expect(byId(list, 'b')?.attachedCount).toBe(0);
  });

  it('an attached copy never moves the story: its score is the shown members alone', () => {
    const without = byId(buildFeedList([A, B], new Set(), NOW), 'a')!;
    const withCopy = byId(buildFeedList([A, B, COPY], new Set(), NOW), 'a')!;
    expect(withCopy.score).toBe(without.score);
    expect(withCopy.breaking).toBe(without.breaking);
  });

  it('the strongest edge decides: a shared story key beats a title match with another card', () => {
    const A2 = sugg('a', { title_en: 'alpha bravo charlie delta', storyKey: 'k1' });
    const E = below('e', { title_en: 'echo foxtrot golf india', storyKey: 'k1' });
    const list = buildFeedList([A2, B, E], new Set(), NOW);
    expect(byId(list, 'a')?.memberIds).toEqual(['a', 'e']);
    expect(byId(list, 'b')?.memberIds).toEqual(['b']);
  });

  it('two copies of one story both attach, though they would also join each other', () => {
    const D2 = below('d2', { title_en: 'alpha bravo charlie kilo lima' });
    const list = buildFeedList([A, COPY, D2], new Set(), NOW);
    expect(list).toHaveLength(1);
    expect(list[0].memberIds).toEqual(['a', 'd', 'd2']);
  });

  it('a muted publication copy never attaches', () => {
    const muted = below('m', { title_en: 'alpha bravo charlie kilo', publication_name: 'Muted' });
    const ctx = {
      homeCountryAlpha3: null,
      otherCountriesAlpha3: [],
      appLanguageBase: 'en',
      publicationMultipliers: new Map([['muted', 0]]),
    };
    const list = buildFeedList([A, muted], new Set(), NOW, ctx);
    expect(list[0].memberIds).toEqual(['a']);
  });
});

describe('a not-read story with an attached copy', () => {
  it('counts only the members Mera has not read as waiting', () => {
    const unread = sugg('u', {
      title_en: 'alpha bravo charlie delta',
      status: ArticleSuggestionStatus.Unscored,
      relevance: 0,
      reason: '',
    });
    const candidates = buildFeedList([unread, COPY], new Set(), NOW, null, { includeUnscored: true });
    expect(candidates[0].memberCount).toBe(2);
    const folded = foldNotReadTail(newNotReadTailSession(), candidates, 200, () => true);
    expect(folded.notReadArticles).toBe(1);
  });
});

describe('Discarded holds every below-gate row no card holds', () => {
  it('the bridging copy is listed, the attached copy is not', () => {
    const { rows } = buildDiscardedStories([A, B, BRIDGE, COPY], null, NOW);
    expect(rows.map((it) => it.id)).toEqual(['c']);
  });

  it('a copy linked to a shown story only by entities attaches nowhere and is listed', () => {
    const tagged = (id: string, title: string, rel: number) => ({
      ...sugg(id, { title_en: title, relevance: rel, reason: rel >= 0.4 ? 'note' : '' }),
      entities: ['European Commission', 'Google', 'Apple'],
      eventType: 'economy',
    });
    const shown = tagged('s', 'commission digital levy giants', 0.6);
    const foreign = tagged('f', 'commission tax google apple meta', 0.2);
    // Display grouping alone joins them through the entity edge.
    expect(buildStoryGroups([groupableOf(shown), groupableOf(foreign)], DISPLAY_GROUPING_OPTIONS)).toHaveLength(1);
    expect(buildDiscardedStories([shown, foreign], null, NOW).rows.map((it) => it.id)).toEqual(['f']);
    expect(buildFeedList([shown, foreign], new Set(), NOW)[0].memberIds).toEqual(['s']);
  });

  it('below-gate copies with no shown story still group among themselves', () => {
    const x = below('x', { title_en: 'mike november oscar papa' });
    const y = below('y', { title_en: 'mike november oscar quebec' });
    const { rows } = buildDiscardedStories([x, y], null, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].memberCount).toBe(2);
  });
});

describe('attachToGroups', () => {
  const item = (id: string, title: string, extra: Partial<GroupableItem> = {}): GroupableItem => ({
    id,
    title,
    clusters: [],
    ...extra,
  });

  it('leaves the shown groups exactly as buildStoryGroups made them', () => {
    const shown = [item('a', 'alpha bravo charlie delta'), item('b', 'echo foxtrot golf hotel')];
    const groups = buildStoryGroups(shown, DISPLAY_GROUPING_OPTIONS);
    const { attachments, unattached } = attachToGroups(
      groups,
      [item('c', 'alpha bravo charlie echo foxtrot golf'), item('d', 'alpha bravo charlie kilo')],
      DISPLAY_GROUPING_OPTIONS,
    );
    expect(groups.map((g) => g.map((m) => m.id))).toEqual([['a'], ['b']]);
    expect(attachments.map((g) => g.map((m) => m.id))).toEqual([['d'], []]);
    expect(unattached.map((m) => m.id)).toEqual(['c']);
  });

  it('a stable cluster shared with two cards is a tie and attaches nowhere', () => {
    const shown = [
      item('a', 'alpha bravo', { clusters: [{ clusterId: 'r1', confidence: 0.9, stableClusterId: 's1' }] }),
      item('b', 'echo foxtrot', { clusters: [{ clusterId: 'r2', confidence: 0.9, stableClusterId: 's2' }] }),
    ];
    const groups = buildStoryGroups(shown, DISPLAY_GROUPING_OPTIONS);
    const x = item('x', 'zulu', {
      clusters: [
        { clusterId: 'r1', confidence: 0.9, stableClusterId: 's1' },
        { clusterId: 'r2', confidence: 0.9, stableClusterId: 's2' },
      ],
    });
    expect(attachToGroups(groups, [x], DISPLAY_GROUPING_OPTIONS).unattached).toEqual([x]);
  });

  it('nothing shown means nothing attaches', () => {
    const x = item('x', 'alpha bravo');
    expect(attachToGroups([], [x], DISPLAY_GROUPING_OPTIONS)).toEqual({ attachments: [], unattached: [x] });
  });
});
