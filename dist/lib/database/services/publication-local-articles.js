"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PUBLICATION_LOCAL_ARTICLES_LIMIT = void 0;
exports.getLocalArticlesForPublication = getLocalArticlesForPublication;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _articleSuggestionStatus = require("../article-suggestion-status");
var _publicationPrefLevel = require("../../algorithms/publication-pref-level");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// publication-local-articles: one publication's articles that are already on
// the device, for the publication page while offline. Read-only.
//
// The feed rows (`article_suggestions`) carry the SOURCE's `publication_name`,
// never a publisher id, so a publication is matched by every name it is known
// by (its source names, see publisher-source-names.ts). Rows the feed will
// never show (`excluded`) are left out. Returned in the same `NewsArticle`
// shape the online list uses, newest first, so the page renders one list type.

/** Cap on rows returned: an offline page is a glance, not an archive. */
const PUBLICATION_LOCAL_ARTICLES_LIMIT = exports.PUBLICATION_LOCAL_ARTICLES_LIMIT = 50;
function toNewsArticle(row) {
  return {
    _id: row.articleId,
    article_url: row.articleUrl ?? '',
    source_uri: row.articleUrl ?? '',
    title: row.titleOriginal ?? row.titleEn ?? '',
    title_en: row.titleEn ?? undefined,
    title_en_internal_only: row.titleEn ?? undefined,
    description: row.descriptionEn ?? '',
    description_en: row.descriptionEn ?? undefined,
    image_url: row.imageUrl ?? undefined,
    original_language_code: row.languageCode ?? undefined,
    category: row.category ?? undefined,
    pubDate: row.firstPubDate.toISOString(),
    publicationSource: {
      _id: row.articleId,
      publication_name: row.publicationName ?? '',
      country_code: row.countryCode ?? ''
    }
  };
}

/**
 * On-device articles whose `publication_name` is one of `names`, newest
 * first, one per article id. An empty name list returns nothing.
 */
async function getLocalArticlesForPublication(names, limit = PUBLICATION_LOCAL_ARTICLES_LIMIT) {
  const exact = (0, _publicationPrefLevel.publisherPrefNames)(names);
  if (exact.length === 0) return [];
  const rows = await _index.default.get('article_suggestions').query(_watermelondb.Q.where('publication_name', _watermelondb.Q.oneOf(exact)), _watermelondb.Q.where('status', _watermelondb.Q.notEq(_articleSuggestionStatus.ArticleSuggestionStatus.Excluded)), _watermelondb.Q.sortBy('first_pub_date', _watermelondb.Q.desc)).fetch();
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row.articleId || seen.has(row.articleId)) continue;
    seen.add(row.articleId);
    out.push(toNewsArticle(row));
    if (out.length >= limit) break;
  }
  return out;
}