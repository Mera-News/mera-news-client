"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.calendarDaysAgo = calendarDaysAgo;
exports.formatDayMonth = formatDayMonth;
exports.mergeVisitedByName = mergeVisitedByName;
exports.visitsForNames = visitsForNames;
var _geoLanguagePriority = require("../algorithms/geo-language-priority");
// visited-publications — pure helpers over the `publication_visits` reads that
// back the Library's Visited page and the publication page's History sub-tab.
//
// RN-free and DB-free (type imports only), so both screens and their tests can
// use them without building the WatermelonDB adapter.
//
// Like the rest of `lib/stats/`, this adds no table, column or counter. It
// regroups rows the app already keeps to run Visited.

/**
 * `getTopVisitedPublications` groups by the EXACT name plus country, so one
 * publication can arrive as several rows ("Der Spiegel" / "DER SPIEGEL", or
 * the same outlet filed under two countries). That split the Visited top card:
 * the real leader could rank second behind its own other half.
 *
 * Rows merge on the normalised name (case and spacing ignored, country
 * ignored). Counts add, which is exact: `recordPublicationVisit` keys a row on
 * its article id within one name and country, so the halves never share an
 * article. The merged row keeps the name and country of its biggest part (ties
 * to the most recent), which is the pair the publication page and the
 * publisher lookup then receive.
 *
 * Sorted the way the service sorts: count, then most recent visit.
 */
function mergeVisitedByName(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = (0, _geoLanguagePriority.normPublicationName)(row.publicationName);
    if (!key) continue;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        merged: {
          ...row
        },
        lead: row
      });
      continue;
    }
    existing.merged.visitCount += row.visitCount;
    existing.merged.lastVisitedAt = Math.max(existing.merged.lastVisitedAt, row.lastVisitedAt);
    const lead = existing.lead;
    if (row.visitCount > lead.visitCount || row.visitCount === lead.visitCount && row.lastVisitedAt > lead.lastVisitedAt) {
      existing.lead = row;
    }
  }
  return [...groups.values()].map(({
    merged,
    lead
  }) => ({
    ...merged,
    publicationName: lead.publicationName,
    countryCode: lead.countryCode
  })).sort((a, b) => b.visitCount !== a.visitCount ? b.visitCount - a.visitCount : b.lastVisitedAt - a.lastVisitedAt);
}

/**
 * The visits that belong to one publication page, matched on every name the
 * page knows it by (its raw name, the profile's name and source names),
 * normalised and in any country, the same rule the Visited merge uses. So a
 * page opened by publisher id shows the same history as one opened by name.
 * Keeps the input order (the service returns newest first).
 */
function visitsForNames(visits, names) {
  const wanted = new Set(names.map(n => (0, _geoLanguagePriority.normPublicationName)(n)).filter(n => n !== null));
  if (wanted.size === 0) return [];
  return visits.filter(v => {
    const key = (0, _geoLanguagePriority.normPublicationName)(v.publicationName);
    return key !== null && wanted.has(key);
  });
}

/**
 * Whole LOCAL calendar days between `ms` and `nowMs`: 0 today, 1 yesterday.
 * Calendar days, not 24h spans, so a visit at 23:50 reads "Yesterday" at
 * 00:10. Shared by the History table's "Last read" and the publication page's
 * "Opened today / yesterday / 4 Oct", so the two can never disagree.
 */
function calendarDaysAgo(ms, nowMs) {
  const day = t => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((day(nowMs) - day(ms)) / 86_400_000);
}

/** "24 Sep" in the reader's own locale; never throws on a thin ICU build. */
function formatDayMonth(ms, locale) {
  try {
    return new Date(ms).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short'
    });
  } catch {
    return new Date(ms).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short'
    });
  }
}