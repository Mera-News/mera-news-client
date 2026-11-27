// "More options" on a follow card goes through the chat session, built from the card alone.
import { canRegenerateWithWebSearch, canRequestMoreOptions, requestMoreOptions } from '@/lib/chat-session/chat-session';
import { growTrackCard, regenerateTrackOptions } from '@/lib/chat-session/cards/track-card-actions';
import { useFloatingChatStore } from '@/lib/stores/floating-chat-store';
import { MAX_FOLLOW_OPTIONS } from '@/lib/chat-session/engine';
import type { ProposalAction, StagedProposal, TrackFeedbackSubject } from '@/lib/news-harness/core/types';
import { resetChatModules } from '@/test/integration/chat/_helpers';
import { attachCloud, settle } from './kit';

jest.setTimeout(30_000);
afterEach(settle);
beforeEach(async () => {
  resetChatModules();
});

const SUBJECT: TrackFeedbackSubject = {
  origin: 'article', surface: 'tracked-stories-chat', articleId: '', title: '', pubDate: null,
  stableClusterId: null, publicationName: null,
};
const track = (label: string): ProposalAction => ({ type: 'track_story', label, searchText: `${label} news`, subject: SUBJECT });

describe('requestMoreOptions', () => {
  it('asks the engine with the shown options, the room left and the card subject', async () => {
    const { engine } = await attachCloud();
    const seen: unknown[] = [];
    engine.moreOptions = async (req) => {
      seen.push(req);
      return { actions: [] , reason: 'none' };
    };
    expect(canRequestMoreOptions()).toBe(true);

    await requestMoreOptions('track-1', [track('DPDP rules'), track('Indian data law'), { type: 'retire_topic', topicText: 'cricket' }]);

    expect(seen).toEqual([{
      proposalId: 'track-1',
      shown: [{ label: 'DPDP rules', searchText: 'DPDP rules news' }, { label: 'Indian data law', searchText: 'Indian data law news' }],
      room: MAX_FOLLOW_OPTIONS - 2,
      subject: SUBJECT,
    }]);
  });

  it('answers none without asking when the card is full or the engine cannot do it', async () => {
    const { engine } = await attachCloud();
    const full = Array.from({ length: MAX_FOLLOW_OPTIONS }, (_, i) => track(`Option ${i}`));
    const ask = jest.fn();
    engine.moreOptions = ask;
    await expect(requestMoreOptions('track-1', full)).resolves.toEqual({ actions: [], reason: 'none' });
    expect(ask).not.toHaveBeenCalled();

    delete engine.moreOptions;
    expect(canRequestMoreOptions()).toBe(false);
    await expect(requestMoreOptions('track-1', [track('A')])).resolves.toEqual({ actions: [], reason: 'none' });
  });

  it('turns a throw into failed', async () => {
    const { engine } = await attachCloud();
    engine.moreOptions = async () => { throw new Error('boom'); };
    await expect(requestMoreOptions('track-1', [track('A')])).resolves.toEqual({ actions: [], reason: 'failed' });
  });
});

describe('Regenerate with web search', () => {
  const store = () => useFloatingChatStore.getState();
  // A non-numeric index: the durable row patch is skipped, the store override is the subject.
  const source = (baseResult: Record<string, unknown>) => ({ resultKey: 'm1::card', baseResult });
  const proposal = (labels: string[]): StagedProposal => ({ id: 'track-1', actions: labels.map(track), explanation: '', expectedEffects: '', chooseOne: true });
  const HINTS = { phraseRoles: { 'us grocery stores thanksgiving': 'exact' }, defaultTick: 'grocery store hours' };

  it('asks with the search query and only the kept rows as shown', async () => {
    const { engine } = await attachCloud();
    const seen: unknown[] = [];
    engine.moreOptions = async (req) => {
      seen.push(req);
      return { actions: [], reason: 'none' };
    };
    expect(canRegenerateWithWebSearch()).toBe(true);
    await requestMoreOptions('track-1', [track('My words'), track('Story A'), track('Story B')], {
      query: 'my words', keep: (label) => label === 'My words',
    });
    expect(seen).toEqual([{
      proposalId: 'track-1',
      shown: [{ label: 'My words', searchText: 'My words news' }],
      room: MAX_FOLLOW_OPTIONS - 1,
      subject: SUBJECT,
      webQuery: 'my words',
    }]);
  });

  it('replaces the story rows, keeps the reader\'s words and a followed row, and moves the default tick', async () => {
    const { engine } = await attachCloud();
    const src = source({ ...HINTS, followed: { 'thanksgiving closures': 'following' } });
    const card = proposal(['us grocery stores thanksgiving', 'Grocery Store Hours', 'Thanksgiving Closures', 'Retail Holiday Trends']);
    store().setProposal(card);
    const asked: unknown[] = [];
    engine.moreOptions = async (req) => {
      asked.push(req.webQuery, req.shown.map((o) => o.label));
      return { actions: [track('Walmart Thanksgiving Hours'), track('Kroger Holiday Closures')] as never };
    };

    const res = await regenerateTrackOptions(src, card);

    expect(asked).toEqual(['us grocery stores thanksgiving', ['us grocery stores thanksgiving', 'Thanksgiving Closures']]);
    expect(res).toEqual({ added: 2, firstNew: 2, state: null });
    const result = store().toolCallResults[src.resultKey];
    expect((result.cardOptions as { label: string }[]).map((o) => o.label)).toEqual([
      'us grocery stores thanksgiving', 'Thanksgiving Closures', 'Walmart Thanksgiving Hours', 'Kroger Holiday Closures',
    ]);
    expect(result.defaultTick).toBe('walmart thanksgiving hours');
    expect(result.phraseRoles).toEqual(HINTS.phraseRoles);
    expect(store().proposal?.actions.map((a) => (a as { label: string }).label)).toHaveLength(4);
    expect(store().trackMore['track-1']).toBeUndefined();
  });

  it('ticks: a tick on a kept row stays, and with none left the first new row is ticked', async () => {
    await attachCloud();
    const src = source(HINTS);
    const card = proposal(['us grocery stores thanksgiving', 'Grocery Store Hours']);
    store().setTrackTicks('track-1', ['grocery store hours']);
    expect(growTrackCard(src, card, [track('Walmart Thanksgiving Hours')], true)).toBe(1);
    expect(store().trackTicks['track-1']).toEqual(['walmart thanksgiving hours']);

    store().setTrackTicks('track-1', ['us grocery stores thanksgiving', 'grocery store hours']);
    growTrackCard(src, card, [track('Kroger Holiday Closures')], true);
    expect(store().trackTicks['track-1']).toEqual(['us grocery stores thanksgiving']);
  });

  it('nothing new, a failure or a stop leaves the card as it was', async () => {
    const { engine } = await attachCloud();
    const src = source(HINTS);
    const card = proposal(['us grocery stores thanksgiving', 'Grocery Store Hours']);
    for (const [reason, state] of [['none', 'none'], ['failed', 'failed'], ['busy', 'failed'], ['stopped', undefined]] as const) {
      engine.moreOptions = async () => ({ actions: [], reason });
      const res = await regenerateTrackOptions(src, card);
      expect(res.added).toBe(0);
      expect(store().trackMore['track-1']).toBe(state);
      expect(store().toolCallResults[src.resultKey]).toBeUndefined();
    }
  });

  it('one request at a time: a second tap, or More options, while it runs does nothing', async () => {
    const { engine } = await attachCloud();
    let release = () => {};
    let calls = 0;
    engine.moreOptions = () => {
      calls += 1;
      return new Promise((r) => { release = () => r({ actions: [], reason: 'none' }); });
    };
    const src = source(HINTS);
    const card = proposal(['us grocery stores thanksgiving', 'Grocery Store Hours']);
    const first = regenerateTrackOptions(src, card);
    expect(store().trackMore['track-1']).toBe('webLoading');
    await expect(regenerateTrackOptions(src, card)).resolves.toMatchObject({ added: 0, state: 'webLoading' });
    expect(calls).toBe(1);
    release();
    await first;
  });
});
