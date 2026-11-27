// feed-algo — the reader's Feed algorithm choices, stored as one JSON settings
// row. Pure: callers read the row and hand the raw string to `parseFeedAlgo`.
//
// The function-level options in read-snapshot, fact-rows-selector and
// feed-entries default to the older behaviour when absent; only a caller that
// passes parsed prefs gets the reader defaults below.

/** Settings-KV key the reader's choices live under. Device-local, not synced. */
export const FEED_ALGO_SETTING_KEY = 'feed_algo';

export interface FeedAlgoPrefs {
  /** A card dwelt past on the Feed counts as read, like an opened one. */
  skippedIsRead: boolean;
  /** How many days an unread High or Emergency story stays. */
  keepDays: 2 | 3 | 7;
  /** An old unseen Medium stays above the fold (it still sorts below fresher ones). */
  mediumStaysAbove: boolean;
  /** A seen story goes behind the fold unless it is pinned. */
  seenBelowFold: boolean;
  /** An unseen High sinks with age like Medium and Low (Emergency never does). */
  highSinks: boolean;
}

export const FEED_ALGO_DEFAULTS: FeedAlgoPrefs = {
  skippedIsRead: true,
  keepDays: 7,
  mediumStaysAbove: true,
  seenBelowFold: true,
  highSinks: false,
};

const KEEP_DAYS: readonly number[] = [2, 3, 7];

/** Parse the stored row. Every missing or invalid field takes its default; never throws. */
export function parseFeedAlgo(raw: string | null | undefined): FeedAlgoPrefs {
  let o: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) o = parsed as Record<string, unknown>;
  } catch {
    // malformed row: all defaults
  }
  const bool = (k: keyof FeedAlgoPrefs): boolean =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : (FEED_ALGO_DEFAULTS[k] as boolean);
  return {
    skippedIsRead: bool('skippedIsRead'),
    keepDays: KEEP_DAYS.includes(o.keepDays as number) ? (o.keepDays as FeedAlgoPrefs['keepDays']) : FEED_ALGO_DEFAULTS.keepDays,
    mediumStaysAbove: bool('mediumStaysAbove'),
    seenBelowFold: bool('seenBelowFold'),
    highSinks: bool('highSinks'),
  };
}

/** The read-snapshot options these prefs mean. */
export function readOptionsOf(p: FeedAlgoPrefs): { skippedIsRead: boolean; keepMs: number } {
  return { skippedIsRead: p.skippedIsRead, keepMs: p.keepDays * 24 * 3600_000 };
}

/** The layout options `layoutFeed` takes; each absent one keeps the older behaviour. */
export type FeedAlgo = Partial<Pick<FeedAlgoPrefs, 'mediumStaysAbove' | 'seenBelowFold' | 'highSinks'>>;
