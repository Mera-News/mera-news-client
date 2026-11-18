"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WINDOW_MS = exports.WINDOW_DAYS = exports.STATS_CARD_IDS = void 0;
exports.availableCards = availableCards;
exports.cardHasData = cardHasData;
exports.computeReadingStats = computeReadingStats;
exports.dailyReads = dailyReads;
exports.emptyReadingStats = emptyReadingStats;
exports.localDateKey = localDateKey;
exports.mondayIndex = mondayIndex;
exports.peakDayCount = peakDayCount;
exports.roundedMedianHours = roundedMedianHours;
var _readingHistoryExport = require("../reading-history-export");
// reading-stats — the pure aggregation core behind the Mera Stats share card.
//
// Pure and total: no react-native, expo, watermelondb, zustand, logger or
// database import at runtime (the two `import type` lines below erase), and no
// clock read — `nowMs` is always injected so a rendered card is a pure function
// of its inputs. The WatermelonDB side lives in `reading-stats-source.ts`, which
// holds no logic.
//
// Everything here is computed from data the app ALREADY keeps to operate:
// `publication_visits` runs the Sources tab and `story_impressions` runs feed
// dedup and the read-story filter. Nothing new is recorded for this card, and
// nothing may be: hard invariant 9 forbids behavioural instrumentation outright.
// That is also why the card shows four figures rather than the seven the
// original design sketched — articles read as a true total, average reading time,
// the skim-versus-read split and articles shared each need a recording that does
// not exist and may not be added.
//
// ## Two windows, and why they are not reconciled
//
// Countries, publications, opened and publish-to-read are all 30-day. Saved and
// followed are PRESENT TENSE and live in `keptNow` for exactly that reason:
// both tables carry a timestamp that would let them be windowed, and windowing
// them would produce a figure nobody asks for. "Articles you saved in the last
// 30 days and have not since removed" is not a fact about reading, it is an
// artefact of intersecting two unrelated rules. So the split is carried in the
// TYPE and each surface states one window rather than averaging them into a
// heading that is true of neither.
//
// ## There is no "articles analysed by AI" figure, and there cannot be
//
// Not a policy refusal, an absence. No device-local record of it exists: the
// closest thing, `article_suggestions.relevance_generation_completed`, is a
// genuine per-article record that the scoring pass ran, but its table is swept
// at 48h, so a 30-day tally is unrecoverable and even a 48-hour one undercounts
// by every row already swept. See `reading-stats-source.ts` for the other six
// candidates and why each fails. The app keeps no running tally of its own work
// because nothing in the product needs one to function.
//
// Three labelling rules are encoded in the SHAPE of what this returns, so a
// caller cannot render an honest-looking number without its caveat:
//
//   1. The 30-day ceiling is real. `WINDOW_DAYS` is not cosmetic — both inputs
//      are filtered to it here.
//   2. `publishToRead` always carries `sampledArticles` and `totalArticles`
//      alongside the average, because `pub_date` is optional and only populated
//      from schema v23 onward. A bare average over the covered subset presented
//      as the whole is the specific bug that rule exists to prevent.
//   3. "Opened at the source" is the windowed `publication_visits` rows, one
//      per article. Suggestion-card taps (`story_impressions.opened`) are
//      partial by design and are not read here at all.

/** Mirrors `DEFAULT_WINDOW_MS` in publication-visit-service.ts. The visits query
 *  already enforces it; this module applies it again rather than trusting it. */
const WINDOW_DAYS = exports.WINDOW_DAYS = 30;
const WINDOW_MS = exports.WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** One row of the opt-in "top publications" list. Name plus country only —
 *  article titles are never included under any setting. */

/**
 * One country the reader has seen news from, inside the window, with how many
 * taps it accounted for.
 *
 * The COUNT is what makes the proportion bar on the reach card honest: shares
 * are computed from these, not from the number of publications, so a country
 * with one prolific publisher is not flattened to the same width as one with
 * six occasional ones.
 */

/**
 * The two figures that are NOT windowed, kept in their own object so a caller
 * cannot render them under a "last 30 days" heading by accident.
 *
 * This is the same trick `publishToRead` plays with its coverage denominator:
 * the SHAPE carries the labelling rule, so the rule cannot be forgotten at a
 * render site. Both are present tense by nature. "Saved" and "following" are
 * states the reader is in right now, not events inside a window, and
 * `saved_at` / `created_at` would let either be windowed but the result would
 * answer a question nobody asks: "articles you saved in the last 30 days and
 * have not since removed" is not a fact about reading, it is an artefact of
 * intersecting two unrelated rules.
 */
/**
 * One language the reader read articles in, inside the window.
 *
 * A DIFFERENT fact from country, not a proxy for it: one publisher in
 * Switzerland produces German, French and Italian rows, and that difference is
 * the whole point of the metric. `language_code` is optional on the row, so
 * rows without one are counted nowhere rather than bucketed as "unknown" —
 * an unknown bucket in a proportion bar is a segment the reader cannot act on.
 */

/**
 * One day, and how many articles the reader read on it.
 *
 * `dateKey` is a LOCAL calendar date (YYYY-MM-DD in the device's timezone),
 * never UTC. Same reasoning as the daily cap copy: a UTC date is simply the
 * wrong day for a large share of readers, and this one is rendered as a grid
 * cell the reader will check against their own memory of yesterday.
 *
 * NOT "days you opened the app". There is no app-open record, no session row
 * and no launch counter anywhere in the schema, and there must not be one. What
 * this counts is articles read, from visit rows the app already keeps to run
 * the Sources tab. Labelling it "opened" would be false AND would invite the
 * next person to add session tracking to make it true, which is exactly the
 * instrumentation hard invariant 9 forbids.
 */

const DEFAULT_TOP_PUBLICATION_LIMIT = 3;

/** A visit row's tap count, floored at 1. A row that exists was visited at
 *  least once, whatever a malformed `visit_count` says. */
function tapsOf(visit) {
  return Number.isFinite(visit.visitCount) && visit.visitCount > 0 ? visit.visitCount : 1;
}
function cleaned(value) {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Every figure, from rows. Total: zero visits and
 * zero rows with a known publish time all return cleanly, and there is no
 * division anywhere that is not guarded by its own count.
 */
function computeReadingStats({
  visits,
  nowMs,
  topPublicationLimit = DEFAULT_TOP_PUBLICATION_LIMIT,
  keptNow
}) {
  const cutoff = nowMs - WINDOW_MS;

  // A visit in the FUTURE (a clock change, or a row written by a device whose
  // time was wrong) is kept rather than dropped: it is inside the window by any
  // reading, and dropping it would silently narrow a count the user can see
  // elsewhere in the Sources tab.
  const windowedVisits = visits.filter(v => Number.isFinite(v.visitedAt) && v.visitedAt >= cutoff);
  const publications = new Set();
  const byLanguage = new Map();
  // Keyed by code so the reach card can weight its proportion bar by taps.
  // A Set would have answered `countryCount` and nothing else.
  const byCountry = new Map();
  const byPublication = new Map();
  for (const visit of windowedVisits) {
    const name = cleaned(visit.publicationName);
    const country = cleaned(visit.countryCode);
    // Counted BEFORE the name guard, deliberately. A visit with a country but
    // no publication name is still a country the reader saw news from, and
    // dropping it would make the flag grid disagree with the Sources tab.
    if (country) {
      const taps = tapsOf(visit);
      const seen = byCountry.get(country);
      if (seen) seen.visitCount += taps;else byCountry.set(country, {
        countryCode: country,
        visitCount: taps
      });
    }
    const language = cleaned(visit.languageCode);
    if (language) {
      const taps = tapsOf(visit);
      const seen = byLanguage.get(language);
      if (seen) seen.visitCount += taps;else byLanguage.set(language, {
        languageCode: language,
        visitCount: taps
      });
    }
    if (!name) continue;
    publications.add(name);
    // Keyed on name AND country: the visits table itself is keyed that way,
    // because two publishers can share a name across markets.
    const key = `${name} ${country ?? ''}`;
    const taps = tapsOf(visit);
    const existing = byPublication.get(key);
    if (existing) {
      existing.visitCount += taps;
    } else {
      byPublication.set(key, {
        publicationName: name,
        countryCode: country,
        visitCount: taps
      });
    }
  }

  // Most-visited first, then by code: `localeCompare` on a country CODE is a
  // stable tie-break and never reaches the user as text, so it needs no locale.
  const countries = [...byCountry.values()].sort((a, b) => {
    if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
    return a.countryCode.localeCompare(b.countryCode);
  });
  const languages = [...byLanguage.values()].sort((a, b) => {
    if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
    return a.languageCode.localeCompare(b.languageCode);
  });
  const days = dailyReads(windowedVisits, nowMs);
  const topPublications = [...byPublication.values()].sort((a, b) => {
    if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
    return a.publicationName.localeCompare(b.publicationName);
  }).slice(0, Math.max(0, topPublicationLimit));

  // Reused rather than reimplemented — this is the same quantity the reading
  // history export reports, and a second implementation would be free to drift
  // into calling it something it is not.
  const publishToRead = (0, _readingHistoryExport.computePublishToReadStats)(windowedVisits);
  return {
    windowDays: WINDOW_DAYS,
    publicationCount: publications.size,
    countryCount: countries.length,
    countries,
    languages,
    languageCount: languages.length,
    days,
    daysReadCount: days.filter(d => d.count > 0).length,
    openedAtSourceCount: windowedVisits.length,
    publishToRead,
    topPublications,
    keptNow: {
      savedArticles: nonNegative(keptNow?.savedArticles),
      followedStories: nonNegative(keptNow?.followedStories)
    }
  };
}

/** A count that is always a whole number at or above zero, whatever arrived. */
function nonNegative(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The shape `computeReadingStats` returns for an empty device. Exported so the
 *  preview screen has something to render before the first read resolves,
 *  rather than branching on null. */
function emptyReadingStats() {
  return {
    windowDays: WINDOW_DAYS,
    publicationCount: 0,
    countryCount: 0,
    countries: [],
    languages: [],
    languageCount: 0,
    days: [],
    daysReadCount: 0,
    openedAtSourceCount: 0,
    publishToRead: {
      averageHours: null,
      medianHours: null,
      sampledArticles: 0,
      totalArticles: 0
    },
    topPublications: [],
    keptNow: {
      savedArticles: 0,
      followedStories: 0
    }
  };
}

/**
 * Rounds the latency MEDIAN for display ("half of what you opened was under N
 * hours old"; an average would make that sentence false). Null when there is
 * no median, which is NOT zero: zero would read as "instant".
 */
function roundedMedianHours(stats) {
  if (stats.medianHours === null) return null;
  return Math.max(0, Math.round(stats.medianHours));
}

// --- per-card availability -------------------------------------------------

/**
 * The seven Stats cards (FinalLibrary #9, #11): one figure each, in page
 * order. Six are last-30-days; `now` is present tense and states its own
 * window (two windows never share a heading).
 */
const STATS_CARD_IDS = exports.STATS_CARD_IDS = ['publications', 'languages', 'days', 'opened', 'fresh', 'now', 'top'];
/**
 * Does this card have anything on it? Per card rather than per screen: the
 * cards draw on different tables, and a reader who cleared their viewing
 * history still has real saved articles (`now`) while every visit card is
 * empty. A card with nothing is left off, never drawn as a zero.
 */
function cardHasData(stats, card) {
  switch (card) {
    case 'publications':
      return stats.publicationCount > 0;
    case 'languages':
      return stats.languageCount > 0;
    case 'days':
      // Days actually READ, not the calendar: the grid is always 30 cells.
      return stats.daysReadCount > 0;
    case 'opened':
      return stats.openedAtSourceCount > 0;
    case 'fresh':
      return stats.publishToRead.medianHours !== null;
    case 'now':
      return stats.keptNow.savedArticles > 0 || stats.keptNow.followedStories > 0;
    case 'top':
      return stats.topPublications.length > 0;
  }
}

/** The cards worth offering, in theme order. Empty for an empty device. */
function availableCards(stats) {
  return STATS_CARD_IDS.filter(card => cardHasData(stats, card));
}

// --- daily reading, for the rhythm grid ------------------------------------

/**
 * A LOCAL calendar date key, `YYYY-MM-DD`, in the device's own timezone.
 *
 * `en-CA` is the shortest way to get ISO order out of the platform's own date
 * formatter, which is what makes this timezone-correct without composing the
 * string by hand or reaching for `toISOString` (which is UTC and would put a
 * late-evening read on tomorrow for every reader east of Greenwich, and an
 * early-morning one on yesterday for every reader west of it).
 */
function localDateKey(ms) {
  return new Date(ms).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

/** 0 = Monday .. 6 = Sunday. The week starts on Monday because the grid's
 *  point is that a reader can SEE their weekends, and a Sunday-first week puts
 *  the two weekend days at opposite ends of the row. */
function mondayIndex(ms) {
  return (new Date(ms).getDay() + 6) % 7;
}

/**
 * One entry per day of the window, oldest first, zeros included.
 *
 * Counts DISTINCT ARTICLES per day. `getAllVisitedArticles` already dedupes a
 * repeated visit to the same article into one row carrying a `visitCount`, so
 * one row is one article and the row count per day is the article count. Using
 * `visitCount` here instead would count re-opens and turn "articles you read
 * that day" into "times you tapped", a different and less honest claim.
 */
function dailyReads(windowedVisits, nowMs, days = WINDOW_DAYS) {
  const counts = new Map();
  for (const visit of windowedVisits) {
    if (!Number.isFinite(visit.visitedAt)) continue;
    const key = localDateKey(visit.visitedAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Walked back from today one calendar day at a time rather than by
  // subtracting 86_400_000, because a DST boundary makes a local day 23 or 25
  // hours long and fixed-millisecond arithmetic silently drops or repeats a day
  // twice a year.
  const out = [];
  const cursor = new Date(nowMs);
  cursor.setHours(12, 0, 0, 0); // midday, so a DST shift cannot cross midnight
  for (let i = 0; i < days; i += 1) {
    const ms = cursor.getTime();
    out.push({
      dateKey: localDateKey(ms),
      count: counts.get(localDateKey(ms)) ?? 0,
      weekday: mondayIndex(ms)
    });
    cursor.setDate(cursor.getDate() - 1);
  }
  return out.reverse();
}

/** The most articles read on any one day, which is what the shading scale is
 *  normalised against. Returns 0 for an empty or all-zero window, and callers
 *  must treat 0 as "draw every cell at the empty tone" rather than dividing. */
function peakDayCount(days) {
  return days.reduce((max, d) => Math.max(max, d.count), 0);
}