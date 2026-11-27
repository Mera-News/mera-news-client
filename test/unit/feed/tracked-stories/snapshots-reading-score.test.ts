import { sanitizeSnapshots } from '@/lib/algorithms/tracked-story-snapshots';

describe('sanitizeSnapshots: readingScore', () => {
  it('keeps a finite number (0 included) and drops anything else', () => {
    const scores = [82, 0, '82', NaN, null, undefined].map((readingScore) =>
      sanitizeSnapshots([{ articleId: 'a', title: 't', pubDateMs: 1, readingScore }])[0].readingScore,
    );
    expect(scores).toEqual([82, 0, undefined, undefined, undefined, undefined]);
  });
});
