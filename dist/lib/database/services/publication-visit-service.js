"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clearAllVisits = void 0;
exports.getAllVisitedArticles = getAllVisitedArticles;
exports.getTopVisitedPublications = getTopVisitedPublications;
exports.getVisitCountForPublication = getVisitCountForPublication;
exports.getVisitedArticleById = getVisitedArticleById;
exports.getVisitsForPublication = getVisitsForPublication;
exports.pruneStaleVisits = pruneStaleVisits;
exports.recordPublicationVisit = recordPublicationVisit;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
var _command = require("../../sync/command");
var _marks = require("../../sync/marks");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Publication-Visit Service — local-only log of every "Read Article" tap.
// Drives the Sources-tab most-visited card, the drill-down list, and the
// per-publication visit-count badge on detail screens. Composite identity
// key is (publication_name, country_code) — country_code disambiguates the
// same publisher name across markets.

const publicationVisitsCol = _index.default.get('publication_visits');
const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const toDate = value => {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
async function recordPublicationVisit(input) {
  const name = (input.publicationName ?? '').trim();
  if (!name) return;
  const country = input.countryCode ?? null;
  const articleId = input.articleId ?? null;
  const articleUrl = input.articleUrl ?? null;
  const now = new Date();
  const pubDate = toDate(input.pubDate);
  try {
    // Identity = article_id. Repeated taps on the same article update
    // visited_at in-place instead of inserting a duplicate row. Rows
    // without an article_id (rare; shouldn't happen for either current
    // call site) are always inserted fresh.
    let existing = null;
    if (articleId) {
      const matches = await publicationVisitsCol.query(_watermelondb.Q.where('publication_name', name), _watermelondb.Q.where('country_code', country), _watermelondb.Q.where('article_id', articleId)).fetch();
      existing = matches[0] ?? null;
    }
    await _index.default.write(async () => {
      if (existing) {
        await existing.update(r => {
          r.visitedAt = now;
          // Refresh any snapshot fields the new visit can provide —
          // earlier v22 rows may have had some fields null.
          if (articleUrl) r.articleUrl = articleUrl;
          if (input.articleSuggestionId) r.articleSuggestionId = input.articleSuggestionId;
          if (input.titleEn) r.titleEn = input.titleEn;
          if (input.titleOriginal) r.titleOriginal = input.titleOriginal;
          if (input.languageCode) r.languageCode = input.languageCode;
          if (input.imageUrl) r.imageUrl = input.imageUrl;
          if (pubDate) r.pubDate = pubDate;
        });
        return;
      }
      await publicationVisitsCol.create(r => {
        r.publicationName = name;
        r.countryCode = country;
        r.articleId = articleId;
        r.articleSuggestionId = input.articleSuggestionId ?? null;
        r.articleUrl = articleUrl;
        r.titleEn = input.titleEn ?? null;
        r.titleOriginal = input.titleOriginal ?? null;
        r.languageCode = input.languageCode ?? null;
        r.imageUrl = input.imageUrl ?? null;
        r.pubDate = pubDate;
        r.visitedAt = now;
      });
    });
    (0, _marks.recordMark)('visit', input);
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'publication-visit',
        method: 'record'
      }
    });
  }
}
async function getVisitCountForPublication(publicationName, countryCode, windowMs = DEFAULT_WINDOW_MS) {
  const name = publicationName.trim();
  if (!name) return 0;
  const cutoff = Date.now() - windowMs;
  try {
    const conditions = [_watermelondb.Q.where('publication_name', name), _watermelondb.Q.where('country_code', countryCode ?? null), _watermelondb.Q.where('visited_at', _watermelondb.Q.gte(cutoff))];
    return await publicationVisitsCol.query(...conditions).fetchCount();
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'publication-visit',
        method: 'getCount'
      }
    });
    return 0;
  }
}
/**
 * Dedupes raw visit rows by (articleId || articleUrl) — repeated visits
 * collapse into a single entry whose `visitedAt` is the most recent tap and
 * `visitCount` is the number of taps among the given rows.
 *
 * Falls back to a per-row entry when neither articleId nor articleUrl is
 * present (shouldn't happen post-v23, but historical rows from v22 could
 * lack snapshot data).
 *
 * Shared by `getVisitsForPublication` (rows pre-filtered to one publication)
 * and `getAllVisitedArticles` (rows across every publication).
 */
function dedupeVisitRows(rows) {
  const grouped = new Map();
  const tappedAt = row => row.visitedAt.getTime();
  // Newest first (id breaks a tie), so the result does not depend on the query's row order.
  const newestFirst = [...rows].sort((a, b) => tappedAt(b) - tappedAt(a) || (a.id < b.id ? -1 : 1));
  for (const row of newestFirst) {
    const dedupeKey = row.articleId ?? row.articleUrl ?? `__row_${row.id}`;
    const visitedAt = tappedAt(row);
    const pubDate = row.pubDate ? row.pubDate.getTime() : null;
    const existing = grouped.get(dedupeKey);
    if (existing) {
      existing.visitCount += 1;
      // Rows arrive newest first: each snapshot field keeps the freshest
      // non-null value — earlier visits may pre-date the v23 columns being
      // populated, and the newest may lack a field an older one has.
      existing.articleSuggestionId ??= row.articleSuggestionId;
      existing.titleEn ??= row.titleEn;
      existing.titleOriginal ??= row.titleOriginal;
      existing.imageUrl ??= row.imageUrl;
      existing.languageCode ??= row.languageCode;
      existing.pubDate ??= pubDate;
    } else {
      grouped.set(dedupeKey, {
        articleId: row.articleId,
        articleSuggestionId: row.articleSuggestionId,
        articleUrl: row.articleUrl,
        publicationName: row.publicationName,
        countryCode: row.countryCode,
        titleEn: row.titleEn,
        titleOriginal: row.titleOriginal,
        languageCode: row.languageCode,
        imageUrl: row.imageUrl,
        pubDate,
        visitedAt,
        visitCount: 1
      });
    }
  }
  return [...grouped.values()];
}

/**
 * Returns each article the user has visited from a given publication,
 * deduped by (articleId || articleUrl) — repeated visits collapse into a
 * single row whose `visitedAt` is the most recent tap and `visitCount` is
 * the number of taps in-window.
 */
async function getVisitsForPublication(publicationName, countryCode, windowMs = DEFAULT_WINDOW_MS) {
  const name = publicationName.trim();
  if (!name) return [];
  const cutoff = Date.now() - windowMs;
  try {
    const rows = await publicationVisitsCol.query(_watermelondb.Q.where('publication_name', name), _watermelondb.Q.where('country_code', countryCode ?? null), _watermelondb.Q.where('visited_at', _watermelondb.Q.gte(cutoff))).fetch();
    return dedupeVisitRows(rows).sort((a, b) => b.visitedAt - a.visitedAt);
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'publication-visit',
        method: 'getVisitsForPublication'
      }
    });
    return [];
  }
}

/**
 * Every visited article across every publication, deduped the same way as
 * `getVisitsForPublication`. Feeds the "export reading history as JSON"
 * feature on the Manage Data screen.
 *
 * Always scoped to `DEFAULT_WINDOW_MS` (30 days) — deliberately not
 * parameterized wider than that. The table itself is pruned to this same
 * window on every app boot (see `pruneStaleVisits`), so this is a hard
 * ceiling, not just a query default: the export can never contain more than
 * 30 days of history.
 */
async function getAllVisitedArticles() {
  const cutoff = Date.now() - DEFAULT_WINDOW_MS;
  try {
    const rows = await publicationVisitsCol.query(_watermelondb.Q.where('visited_at', _watermelondb.Q.gte(cutoff))).fetch();
    return dedupeVisitRows(rows).sort((a, b) => b.visitedAt - a.visitedAt);
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'publication-visit',
        method: 'getAllVisitedArticles'
      }
    });
    return [];
  }
}

/**
 * The most recent visit row for one article id, or null.
 *
 * Exists so the article-detail screen can still render a story whose server row
 * has TTL'd out. Server articles are deleted after 48h (`v3_ingestedAt_ttl`),
 * while the visit log keeps 30 days — so most rows in the per-publication
 * history point at an article `articleById` no longer returns. Every surface now
 * routes through the detail screen (it owns the translate affordance), and a
 * detail screen that dead-ends on "article unavailable" would be worse than the
 * direct-open it replaced. These snapshot columns carry exactly what that screen
 * needs: title (both variants), source language, image, publisher and the URL.
 */
async function getVisitedArticleById(articleId) {
  const id = articleId.trim();
  if (!id) return null;
  try {
    const rows = await publicationVisitsCol.query(_watermelondb.Q.where('article_id', id)).fetch();
    if (rows.length === 0) return null;
    const toMs = v => {
      if (v == null) return null;
      return v instanceof Date ? v.getTime() : Number(v);
    };

    // Freshest visit wins — later rows carry the most complete snapshot (early
    // v22 rows pre-date the snapshot columns entirely).
    const row = rows.reduce((best, candidate) => (toMs(candidate.visitedAt) ?? 0) > (toMs(best.visitedAt) ?? 0) ? candidate : best);
    return {
      articleId: row.articleId,
      articleSuggestionId: row.articleSuggestionId,
      articleUrl: row.articleUrl,
      publicationName: row.publicationName,
      countryCode: row.countryCode,
      titleEn: row.titleEn,
      titleOriginal: row.titleOriginal,
      languageCode: row.languageCode,
      imageUrl: row.imageUrl,
      pubDate: toMs(row.pubDate),
      visitedAt: toMs(row.visitedAt) ?? 0,
      visitCount: rows.length
    };
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'publication-visit',
        method: 'getVisitedArticleById'
      },
      extra: {
        articleId
      }
    });
    return null;
  }
}
/**
 * Deletes visit rows older than `windowMs` (default 30 days). Called once
 * per app boot from `hydrateAllStores` so the table can't grow unbounded —
 * rows past the rolling window are never surfaced anyway. Cheap: an indexed
 * range scan + permanent destroy.
 */
async function pruneStaleVisits(windowMs = DEFAULT_WINDOW_MS) {
  try {
    const cutoff = Date.now() - windowMs;
    const stale = await publicationVisitsCol.query(_watermelondb.Q.where('visited_at', _watermelondb.Q.lt(cutoff))).fetch();
    if (stale.length === 0) return;
    await _index.default.write(async () => {
      await _index.default.batch(...stale.map(r => r.prepareDestroyPermanently()));
    });
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'publication-visit',
        method: 'prune'
      }
    });
  }
}

/**
 * Wipes every row in `publication_visits`. Wired into the "Clear viewing
 * history" button on the Manage Data screen.
 */
async function clearAllVisitsLocal() {
  try {
    const rows = await publicationVisitsCol.query().fetch();
    if (rows.length === 0) return;
    await _index.default.write(async () => {
      await _index.default.batch(...rows.map(r => r.prepareDestroyPermanently()));
    });
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'publication-visit',
        method: 'clearAll'
      }
    });
    throw error;
  }
}
const clearAllVisits = exports.clearAllVisits = (0, _command.command)('clearAllVisits', clearAllVisitsLocal);
async function getTopVisitedPublications(opts) {
  const limit = opts?.limit ?? Infinity;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const cutoff = Date.now() - windowMs;
  try {
    const rows = await publicationVisitsCol.query(_watermelondb.Q.where('visited_at', _watermelondb.Q.gte(cutoff))).fetch();
    const grouped = new Map();
    for (const row of rows) {
      const country = row.countryCode ?? null;
      const key = `${row.publicationName}\u0000${country ?? ''}`;
      const visitedAt = row.visitedAt.getTime();
      const existing = grouped.get(key);
      if (existing) {
        existing.visitCount += 1;
        if (visitedAt > existing.lastVisitedAt) {
          existing.lastVisitedAt = visitedAt;
        }
      } else {
        grouped.set(key, {
          publicationName: row.publicationName,
          countryCode: country,
          visitCount: 1,
          lastVisitedAt: visitedAt
        });
      }
    }
    const sorted = [...grouped.values()].sort((a, b) => {
      if (b.visitCount !== a.visitCount) return b.visitCount - a.visitCount;
      return b.lastVisitedAt - a.lastVisitedAt;
    });
    return Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'publication-visit',
        method: 'getTop'
      }
    });
    return [];
  }
}