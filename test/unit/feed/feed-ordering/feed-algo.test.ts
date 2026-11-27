// feed-algo: the parser of the reader's stored Feed algorithm row. It never
// throws, and every missing or invalid field falls back to its own default.

import { FEED_ALGO_DEFAULTS, parseFeedAlgo, readOptionsOf } from '@/lib/feed-ordering/feed-algo';

const DAY = 24 * 3_600_000;

describe('parseFeedAlgo', () => {
  it('no row or garbage gives the defaults', () => {
    for (const raw of [null, undefined, '', 'not json', '42', '[true]', 'null', '"x"']) {
      expect(parseFeedAlgo(raw)).toEqual(FEED_ALGO_DEFAULTS);
    }
  });

  it('a partial row keeps the fields it has and defaults the rest', () => {
    expect(parseFeedAlgo(JSON.stringify({ highSinks: true, keepDays: 3 }))).toEqual({
      ...FEED_ALGO_DEFAULTS,
      highSinks: true,
      keepDays: 3,
    });
    expect(parseFeedAlgo(JSON.stringify({ skippedIsRead: false }))).toEqual({
      ...FEED_ALGO_DEFAULTS,
      skippedIsRead: false,
    });
  });

  it('a wrong type falls back per field', () => {
    const out = parseFeedAlgo(
      JSON.stringify({ skippedIsRead: 'no', mediumStaysAbove: 0, seenBelowFold: false, highSinks: null }),
    );
    expect(out).toEqual({ ...FEED_ALGO_DEFAULTS, seenBelowFold: false });
  });

  it('keepDays outside 2, 3 or 7 falls back to 7', () => {
    for (const keepDays of [0, 1, 4, 2.5, -7, '3', null, 30]) {
      expect(parseFeedAlgo(JSON.stringify({ keepDays })).keepDays).toBe(7);
    }
    expect(parseFeedAlgo(JSON.stringify({ keepDays: 2 })).keepDays).toBe(2);
  });
});

describe('readOptionsOf', () => {
  it('carries skippedIsRead and turns keepDays into ms', () => {
    expect(readOptionsOf(FEED_ALGO_DEFAULTS)).toEqual({ skippedIsRead: true, keepMs: 7 * DAY });
    expect(readOptionsOf({ ...FEED_ALGO_DEFAULTS, skippedIsRead: false, keepDays: 2 })).toEqual({
      skippedIsRead: false,
      keepMs: 2 * DAY,
    });
  });
});
