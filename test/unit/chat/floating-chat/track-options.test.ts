import {
  keptTrackKeys,
  MAX_TRACK_CARD_OPTIONS,
  mergeTrackOptions,
  readCardOptions,
  readTrackOutcomes,
  trackCardStatus,
  webQueryForCard,
} from '@/lib/chat-session/cards/track-options';

const opt = (label: string, search = label.toLowerCase()) => ({ label, search });

describe('mergeTrackOptions', () => {
  it('appends new options after the shown ones, in order', () => {
    const { options, added } = mergeTrackOptions([opt('A'), opt('B')], [opt('C'), opt('D')]);
    expect(options.map((o) => o.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(added).toBe(2);
  });

  it('drops an option whose label matches a shown one, ignoring case and spacing', () => {
    const { options } = mergeTrackOptions([opt('Artemis II launch', 'x')], [opt('  artemis  ii LAUNCH ', 'y')]);
    expect(options).toHaveLength(1);
  });

  it('drops an option whose search text matches a shown one under a new label', () => {
    const { added } = mergeTrackOptions([opt('Moon mission', 'nasa artemis moon')], [opt('Lunar programme', 'NASA  Artemis moon')]);
    expect(added).toBe(0);
  });

  it('drops a duplicate inside the same answer', () => {
    const { options } = mergeTrackOptions([opt('A')], [opt('C', 'c1'), opt('c', 'c2'), opt('D', 'c1')]);
    expect(options.map((o) => o.label)).toEqual(['A', 'C']);
  });

  it('drops a near-copy label (content-word Jaccard >= 0.6) of a shown or earlier-kept one', () => {
    const shown = [opt('Rotterdam Port Strike', 'a')];
    const { options } = mergeTrackOptions(shown, [
      opt('Rotterdam port strike updates', 'b'),
      opt('Shipping Lines Reroute', 'c'),
      opt('Shipping Lines Reroute plan', 'e'),
    ]);
    expect(options.map((o) => o.label)).toEqual(['Rotterdam Port Strike', 'Shipping Lines Reroute']);
  });

  it('keeps a label at Jaccard 0.5', () => {
    // {rotterdam, port} vs {rotterdam, port, strike, union}: 2/4
    const { added } = mergeTrackOptions([opt('Rotterdam port', 'a')], [opt('Rotterdam port strike union', 'b')]);
    expect(added).toBe(1);
  });

  it('stops at the cap', () => {
    const shown = Array.from({ length: 6 }, (_, i) => opt(`S${i}`));
    const { options, added } = mergeTrackOptions(shown, [opt('N1'), opt('N2'), opt('N3')]);
    expect(options).toHaveLength(MAX_TRACK_CARD_OPTIONS);
    expect(added).toBe(2);
  });

  it('adds nothing for an empty answer or blank labels', () => {
    expect(mergeTrackOptions([opt('A')], []).added).toBe(0);
    expect(mergeTrackOptions([opt('A')], [opt('  ', 'z')]).added).toBe(0);
  });
});

describe('readCardOptions', () => {
  it('reads up to 8 options and falls back to the label for a missing search', () => {
    const raw = [...Array.from({ length: 9 }, (_, i) => ({ label: `L${i}`, search: `s${i}` })), { label: 'X' }];
    expect(readCardOptions(raw)).toHaveLength(8);
    expect(readCardOptions([{ label: 'X' }])).toEqual([{ label: 'X', search: 'X' }]);
  });

  it('is null when absent, malformed or empty', () => {
    expect(readCardOptions(undefined)).toBeNull();
    expect(readCardOptions('x')).toBeNull();
    expect(readCardOptions([{ search: 'no label' }])).toBeNull();
  });
});

describe('readTrackOutcomes', () => {
  it('keeps the known outcomes only', () => {
    expect(readTrackOutcomes({ a: 'following', b: 'already', c: 'failed', d: 'odd' })).toEqual({
      a: 'following',
      b: 'already',
      c: 'failed',
    });
    expect(readTrackOutcomes(null)).toEqual({});
  });
});

describe('Regenerate with web search: the query and the kept rows', () => {
  const rows = [opt('us grocery stores thanksgiving'), opt('US Grocery Stores Thanksgiving'), opt('Thanksgiving Store Hours', 'US grocery store hours Thanksgiving')];

  it('searches the corrected phrase, then the exact one, then the subject row', () => {
    const roles = { 'us grocery stores thanksgiving': 'exact', 'us grocery stores thanksgiving ': 'ignored' };
    expect(webQueryForCard({ phraseRoles: { ...roles, 'thanksgiving store hours': 'corrected' } }, rows)).toBe('Thanksgiving Store Hours');
    expect(webQueryForCard({ phraseRoles: roles }, rows)).toBe('us grocery stores thanksgiving');
    expect(webQueryForCard({ storySubjects: ['Thanksgiving Store Hours'] }, rows)).toBe('Thanksgiving Store Hours');
  });

  it('with no reader words on the card: the article title, else the first story row\'s search text', () => {
    expect(webQueryForCard({}, rows, ' Grocers plan Thanksgiving hours ')).toBe('Grocers plan Thanksgiving hours');
    expect(webQueryForCard({}, rows, '')).toBe('us grocery stores thanksgiving');
    expect(webQueryForCard({ phraseRoles: { constructor: 'exact' } }, [opt('constructor', 'F1 constructor standings')])).toBe('constructor');
    expect(webQueryForCard({}, [opt('constructor', 'F1 constructor standings')])).toBe('F1 constructor standings');
  });

  it('is cut at 200 characters and null when nothing is long enough', () => {
    expect(webQueryForCard({}, [opt('Long', 'x'.repeat(300))])).toHaveLength(200);
    expect(webQueryForCard({}, [opt('A', 'a')])).toBeNull();
    expect(webQueryForCard({}, [])).toBeNull();
  });

  it('keeps the reader\'s rows, the subject rows and every row with an outcome', () => {
    const kept = keptTrackKeys({
      phraseRoles: { 'my words': 'exact' },
      storySubjects: ['Rally Finland'],
      followed: { 'wrc results': 'following', 'rally news': 'failed' },
    });
    expect([...kept].sort()).toEqual(['my words', 'rally finland', 'rally news', 'wrc results']);
    expect(keptTrackKeys({}).has('constructor')).toBe(false);
  });
});

describe('trackCardStatus', () => {
  const s = (outcomes: Record<string, 'following' | 'already' | 'failed'>, dismissed = false, superseded = false) =>
    trackCardStatus({ outcomes, dismissed, superseded });

  it('is pending with nothing done', () => expect(s({})).toBe('pending'));
  it('is followed once a row followed and none failed, already counting as done', () => {
    expect(s({ a: 'following' })).toBe('followed');
    expect(s({ a: 'already' })).toBe('followed');
  });
  it('stays pending while a row failed, so it can be tried again', () => {
    expect(s({ a: 'following', b: 'failed' })).toBe('pending');
    expect(s({ a: 'failed' })).toBe('pending');
  });
  it('is dismissed on Not now with nothing followed', () => expect(s({}, true)).toBe('dismissed'));
  it('expires only when replaced with nothing followed', () => {
    expect(s({}, false, true)).toBe('expired');
    expect(s({ a: 'failed' }, false, true)).toBe('expired');
  });
  it('a card with a followed row never flips to expired or dismissed', () => {
    expect(s({ a: 'following', b: 'failed' }, false, true)).toBe('followed');
    expect(s({ a: 'following', b: 'failed' }, true)).toBe('followed');
  });
});
