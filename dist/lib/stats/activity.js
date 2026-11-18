"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FRESH_BANDS = void 0;
exports.buildActivityShareText = buildActivityShareText;
exports.countryRows = countryRows;
exports.filterVisits = filterVisits;
exports.freshnessBands = freshnessBands;
exports.languageRows = languageRows;
var _geoLanguagePriority = require("../algorithms/geo-language-priority");
var _readingStats = require("./reading-stats");
// activity — the pure regroupings behind the Library Activity page's detail
// screens (Where you read, Languages, What you opened, How fresh) and their
// text shares. RN-free and DB-free (type imports only).
//
// Like the rest of `lib/stats/`, this adds no table, column or counter: every
// figure is a regrouping of the windowed `publication_visits` rows the Stats
// already read (`getAllVisitedArticles`, one row per article).

/** One country on Where you read. */

/** Every country with an article, most articles first, then by code. */
function countryRows(visits) {
  const by = new Map();
  for (const v of visits) {
    const code = (v.countryCode ?? '').trim();
    if (!code) continue;
    const row = by.get(code) ?? {
      names: new Set(),
      articles: 0
    };
    row.articles += 1;
    const name = (0, _geoLanguagePriority.normPublicationName)(v.publicationName);
    if (name) row.names.add(name);
    by.set(code, row);
  }
  return [...by.entries()].map(([countryCode, r]) => ({
    countryCode,
    publications: r.names.size,
    articles: r.articles
  })).sort((a, b) => b.articles - a.articles || a.countryCode.localeCompare(b.countryCode));
}

/** One language on the Languages screen: its articles and their share. */

/** Every language, most articles first. Rows without a language count nowhere
 *  (the Languages card's rule). */
function languageRows(visits) {
  const by = new Map();
  for (const v of visits) {
    const code = (v.languageCode ?? '').trim();
    if (code) by.set(code, (by.get(code) ?? 0) + 1);
  }
  const total = [...by.values()].reduce((s, n) => s + n, 0);
  return [...by.entries()].map(([languageCode, articles]) => ({
    languageCode,
    articles,
    share: total > 0 ? articles / total : 0
  })).sort((a, b) => b.articles - a.articles || a.languageCode.localeCompare(b.languageCode));
}

/** The reading log's filters. `day` is a local `YYYY-MM-DD` (`DayRead.dateKey`). */

/** The visits a filter keeps, input order kept (the service returns newest first). */
function filterVisits(visits, filter) {
  return visits.filter(v => (!filter.language || (v.languageCode ?? '').trim() === filter.language) && (!filter.day || (0, _readingStats.localDateKey)(v.visitedAt) === filter.day));
}

/** How fresh's bands, by upper bound in hours. The last is open-ended. */
const FRESH_BANDS = exports.FRESH_BANDS = ['hour', 'sixHours', 'day', 'threeDays', 'older'];
const BAND_UPPER_HOURS = [1, 6, 24, 72, Infinity];
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Publish-to-read age per article, banded: the same rows and the same
 * `visitedAt - pubDate` the How fresh card's median uses
 * (`computePublishToReadStats`). A publish time after the visit (a clock or
 * feed error) lands in the first band, as it sorts first for the median.
 */
function freshnessBands(visits) {
  const counts = FRESH_BANDS.map(() => 0);
  let sampled = 0;
  for (const v of visits) {
    if (v.pubDate == null) continue;
    const hours = (v.visitedAt - v.pubDate) / MS_PER_HOUR;
    counts[BAND_UPPER_HOURS.findIndex(upper => hours < upper)] += 1;
    sampled += 1;
  }
  return {
    counts,
    sampled,
    total: visits.length
  };
}

/**
 * A text share: a heading, one line per item, then the "Shared via" footer
 * and the privacy line, blocks split by a blank line (useShareArticle's shape).
 */
function buildActivityShareText(heading, lines, footer, privacy) {
  return [heading, lines.join('\n'), footer, privacy].filter(Boolean).join('\n\n');
}