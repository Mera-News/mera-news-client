import { compareReadingRank, readingRank } from '@/lib/algorithms/reading-rank';
import { makeRepCompare, type RepresentativeGroupItem } from '@/lib/algorithms/representative-compare';
import type { UserGeoLanguageContext } from '@/lib/algorithms/geo-language-priority';

const art = (languageCode: string | null, readingScore: number | null) => ({ languageCode, readingScore });

describe('readingRank', () => {
  it('adds the reader-language lift only from 50 up, and only for a scored article', () => {
    expect(readingRank(50, true)).toBe(1050);
    expect(readingRank(49, true)).toBe(49);
    expect(readingRank(100, false)).toBe(100);
    expect(readingRank(0, true)).toBe(0);
    expect(readingRank(null, true)).toBe(0);
    expect(readingRank(Number.NaN, true)).toBe(0);
  });
});

describe('compareReadingRank', () => {
  it('a reader-language 50 beats an other-language 100', () => {
    expect(compareReadingRank(art('fr', 50), art('en', 100), 'fr')).toBeLessThan(0);
    expect(compareReadingRank(art('en', 100), art('fr', 50), 'fr')).toBeGreaterThan(0);
  });

  it('a reader-language 49 loses to an other-language 60', () => {
    expect(compareReadingRank(art('fr', 49), art('en', 60), 'fr')).toBeGreaterThan(0);
  });

  it('two unscored articles tie, so the caller keeps its order', () => {
    expect(compareReadingRank(art('fr', null), art('en', null), 'fr')).toBe(0);
  });

  it('an unscored reader-language article loses to a scored other-language one', () => {
    expect(compareReadingRank(art('fr', null), art('en', 10), 'fr')).toBeGreaterThan(0);
  });

  it('an unscored reader-language article ties with an other-language 0', () => {
    expect(compareReadingRank(art('fr', null), art('en', 0), 'fr')).toBe(0);
  });

  it('with no reader language the higher score wins, language ignored', () => {
    expect(compareReadingRank(art('fr', 50), art('en', 60), null)).toBeGreaterThan(0);
    expect(compareReadingRank(art('en', 60), art('fr', 50), null)).toBeLessThan(0);
  });

  it('matches the raw stored code on its base tag', () => {
    expect(compareReadingRank(art('en-GB', 50), art('fr', 90), 'en')).toBeLessThan(0);
  });

  it('equal scores in the same language tie', () => {
    expect(compareReadingRank(art('fr', 80), art('fr-CA', 80), 'fr')).toBe(0);
  });
});

describe('makeRepCompare: the reading rank sits after the source tier, before geo and image', () => {
  const item = (
    _id: string,
    over: Partial<RepresentativeGroupItem['s']> = {},
  ): RepresentativeGroupItem => ({
    s: {
      _id,
      firstPubDate: '2026-01-01T00:00:00.000Z',
      rawScore: null,
      publication_name: null,
      country_code: null,
      language_code: null,
      image_url: 'https://example.com/i.jpg',
      ...over,
    },
  });
  const ctx: UserGeoLanguageContext = {
    homeCountryAlpha3: 'USA',
    otherCountriesAlpha3: [],
    appLanguageBase: 'fr',
    preferredPublications: new Set(['the paper']),
  };
  const first = (a: RepresentativeGroupItem, b: RepresentativeGroupItem) =>
    [a, b].sort(makeRepCompare(ctx))[0].s._id;

  it('a higher score beats the home country and an image', () => {
    const home = item('home', { country_code: 'USA', language_code: 'en', readingScore: 40 });
    const scored = item('scored', { language_code: 'de', readingScore: 60, image_url: null });
    expect(first(home, scored)).toBe('scored');
    expect(first(scored, home)).toBe('scored');
  });

  it('a preferred publication still wins over a better score', () => {
    const preferred = item('pref', { publication_name: 'The Paper', readingScore: 10 });
    const scored = item('scored', { language_code: 'fr', readingScore: 95 });
    expect(first(scored, preferred)).toBe('pref');
  });

  it('with nothing scored, the order is the old one (home country first)', () => {
    const home = item('home', { country_code: 'USA', language_code: 'en' });
    const fr = item('fr', { language_code: 'fr' });
    expect(first(fr, home)).toBe('home');
  });
});
