"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildFactCheckShareMessage = buildFactCheckShareMessage;
exports.buildFactChecksJson = buildFactChecksJson;
exports.buildFactChecksMarkdown = buildFactChecksMarkdown;
exports.factCheckContent = factCheckContent;
exports.factCheckTextLabels = factCheckTextLabels;
exports.shareDate = shareDate;
exports.sourceDomain = sourceDomain;
exports.toFactCheckExportRows = toFactCheckExportRows;
var _secureUrl = require("../algorithms/secure-url");
var _factCheckState = require("./fact-check-state");
/**
 * A fact check as plain text: the article panel's Share message (one check)
 * and the Library's export (several, as Markdown or JSON). Pure: copy comes in
 * through `FactCheckTextLabels`, so the caller picks the language.
 *
 * Organisation names and raw ratings are data, never re-worded here; the
 * labels decide how a rating reads (`describeOrganisationVerdict`). Only
 * secure links leave the device. A row that is not terminal is never
 * exported: during a recheck it is `pending` but still holds the OLD verdict.
 */

/** The labels in one language (`lng`, else the app's): Share writes them in the
 *  language of the headline it shares, like `useShareArticle`'s footer. */
function factCheckTextLabels(t, lng) {
  const tr = (key, opts = {}) => t(key, {
    ...opts,
    lng
  });
  return {
    factChecks: tr('factCheck.title'),
    claims: tr('factCheck.claimsHeading'),
    aiSummary: tr('factCheck.share.aiSummary'),
    sources: tr('factCheck.share.sources'),
    noneFound: tr('factCheck.dashboard.noneFound'),
    rating: raw => {
      const info = (0, _factCheckState.describeOrganisationVerdict)(raw);
      return info.isKey ? tr(info.label) : info.label;
    },
    assessment: raw => tr((0, _factCheckState.describeAssessment)(raw).labelKey),
    rated: (organisation, rating, summary) => summary ? tr('factCheck.share.ratedSaid', {
      organisation,
      rating,
      summary
    }) : tr('factCheck.share.rated', {
      organisation,
      rating
    })
  };
}

/** "24 Oct 2026" in `lng`; null for no date or one that does not parse. */
function shareDate(value, lng) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const opts = {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  };
  try {
    return date.toLocaleDateString(lng, opts);
  } catch {
    // RangeError on a malformed tag: never throw out of a share.
    return date.toLocaleDateString(undefined, opts);
  }
}

/** "https://www.thefederal.com/x" -> "thefederal.com", the label of a source row. */
function sourceDomain(uri) {
  return uri.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i)?.[1] ?? uri;
}
const oneLine = value => (value ?? '').replace(/\s+/g, ' ').trim();
const secure = url => url && (0, _secureUrl.isSecureUrl)(url) ? url : null;
function factCheckContent(payload) {
  return {
    factChecks: (0, _factCheckState.describeCheckedBy)(payload?.checkedBy).map(entry => ({
      organisation: entry.organisation.trim(),
      rating: oneLine(entry.verdict) || null,
      summary: oneLine(entry.summary) || null,
      url: secure(entry.url)
    })),
    claims: (payload?.claims ?? []).filter(c => !!c && oneLine(c.claim)).map(c => ({
      claim: oneLine(c.claim),
      assessment: c.assessment ?? ''
    })),
    summary: oneLine(payload?.summary) || null,
    sources: (payload?.citations ?? []).map(c => secure(c?.uri)).filter(u => !!u)
  };
}
const ratedLine = (entry, labels) => labels.rated(entry.organisation, labels.rating(entry.rating), entry.summary);
const claimLines = (claims, labels) => claims.map((c, i) => `${i + 1}. ${c.claim} ${labels.assessment(c.assessment)}`);

/** Joins a heading and its lines, or nothing when there are no lines. */
const section = (heading, lines) => lines.length > 0 ? [heading, ...lines].join('\n') : null;

/**
 * The Share message: headline block, fact checks, claims, Mera's AI summary,
 * sources, then the footer, blank-line separated. Empty sections are left out.
 */
function buildFactCheckShareMessage(params) {
  const {
    article,
    content,
    labels,
    footer
  } = params;
  const byline = [article.publication, article.date].filter(Boolean).join(', ');
  const head = [article.title, byline, article.url].filter(Boolean).join('\n');
  return [head || null, section(labels.factChecks, content.factChecks.flatMap(e => [ratedLine(e, labels), ...(e.url ? [e.url] : [])])), section(labels.claims, claimLines(content.claims, labels)), section(labels.aiSummary, content.summary ? [content.summary] : []), section(labels.sources, content.sources), footer].filter(Boolean).join('\n\n');
}

/** One exported check. `null` = not included; `[]` = included, none found. */

function toFactCheckExportRows(items, opts) {
  return items.filter(item => (0, _factCheckState.isTerminalStatus)(item.status)).map(item => {
    const content = factCheckContent(item.payload);
    const checked = item.resolvedAt ?? item.requestedAt;
    return {
      title: oneLine(item.articleTitle ?? item.payload?.articleTitle),
      publication: oneLine(item.payload?.publicationName) || null,
      url: secure(item.payload?.articleUrl),
      checkedAt: checked ? new Date(checked).toISOString() : null,
      factChecks: content.factChecks,
      claims: opts.includeClaims ? content.claims : null,
      meraAiSummary: opts.includeSummary ? content.summary : null,
      sources: opts.includeSources ? content.sources : null
    };
  });
}
function buildFactChecksMarkdown(rows, labels) {
  const out = [`# ${labels.docTitle}`, '', labels.docExported];
  const block = (heading, lines) => {
    if (lines.length > 0) out.push('', `**${heading}**`, ...lines);
  };
  for (const row of rows) {
    out.push('', `## ${row.title || labels.factChecks}`);
    const meta = [row.publication, row.checkedAt?.slice(0, 10)].filter(Boolean);
    if (meta.length > 0) out.push(meta.join(' · '));
    if (row.url) out.push(row.url);
    out.push('');
    if (row.factChecks.length === 0) out.push(labels.noneFound);
    for (const entry of row.factChecks) {
      out.push(`- ${ratedLine(entry, labels)}${entry.url ? ` ${entry.url}` : ''}`);
    }
    block(labels.claims, claimLines(row.claims ?? [], labels));
    block(labels.aiSummary, row.meraAiSummary ? [row.meraAiSummary] : []);
    block(labels.sources, (row.sources ?? []).map(u => `- ${u}`));
  }
  out.push('');
  return out.join('\n');
}
function buildFactChecksJson(rows, opts, now = new Date()) {
  return JSON.stringify({
    exportedAt: now.toISOString(),
    count: rows.length,
    includesClaims: opts.includeClaims,
    includesMeraAiSummary: opts.includeSummary,
    includesSources: opts.includeSources,
    factChecks: rows
  }, null, 2);
}