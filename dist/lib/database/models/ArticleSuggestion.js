"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _dec10, _dec11, _dec12, _dec13, _dec14, _dec15, _dec16, _dec17, _dec18, _dec19, _dec20, _dec21, _dec22, _dec23, _dec24, _dec25, _dec26, _dec27, _dec28, _dec29, _dec30, _dec31, _dec32, _dec33, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _descriptor10, _descriptor11, _descriptor12, _descriptor13, _descriptor14, _descriptor15, _descriptor16, _descriptor17, _descriptor18, _descriptor19, _descriptor20, _descriptor21, _descriptor22, _descriptor23, _descriptor24, _descriptor25, _descriptor26, _descriptor27, _descriptor28, _descriptor29, _descriptor30, _descriptor31, _descriptor32, _descriptor33, _ArticleSuggestion;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * The WatermelonDB `id` field IS the MongoDB `_id` of the server-side
 * ArticleSuggestion. Seeded via `_raw.id = a._id` at prepareCreate time, so
 * there is no separate `server_id` column.
 *
 * `clusterMembershipsJson` is the latest list of clusters this article belongs
 * to, each with its HDBSCAN membership confidence — refreshed every sync
 * (overwritten unconditionally, including when empty). An article can be in
 * multiple clusters via the server's `cluster-article-link` model. The For-You
 * feed collapses suggestions whose dense (high-confidence) cluster cores
 * overlap into a single representative card. The detail screen's "related
 * articles" panel still calls `relatedArticles(articleId)` to get the
 * authoritative live cluster siblings.
 */
let ArticleSuggestion = exports.default = (_dec = (0, _decorators.field)('article_id'), _dec2 = (0, _decorators.field)('cluster_memberships_json'), _dec3 = (0, _decorators.field)('relevance'), _dec4 = (0, _decorators.field)('reason'), _dec5 = (0, _decorators.field)('status'), _dec6 = (0, _decorators.field)('country_code'), _dec7 = (0, _decorators.field)('language_code'), _dec8 = (0, _decorators.field)('publication_name'), _dec9 = (0, _decorators.field)('title_en'), _dec0 = (0, _decorators.field)('title_original'), _dec1 = (0, _decorators.field)('description_en'), _dec10 = (0, _decorators.field)('article_url'), _dec11 = (0, _decorators.field)('image_url'), _dec12 = (0, _decorators.field)('matched_topic_texts_json'), _dec13 = (0, _decorators.field)('geo_tags_json'), _dec14 = (0, _decorators.field)('entities_json'), _dec15 = (0, _decorators.field)('event_type'), _dec16 = (0, _decorators.field)('category'), _dec17 = (0, _decorators.field)('max_cluster_size'), _dec18 = (0, _decorators.field)('stable_cluster_id'), _dec19 = (0, _decorators.field)('headline_scope'), _dec20 = (0, _decorators.field)('headline_country_code'), _dec21 = (0, _decorators.field)('matched_topics_json'), _dec22 = (0, _decorators.field)('story_key'), _dec23 = (0, _decorators.field)('computed_score'), _dec24 = (0, _decorators.field)('raw_score'), _dec25 = (0, _decorators.field)('score_components_json'), _dec26 = (0, _decorators.field)('scored_at'), _dec27 = (0, _decorators.field)('score_failed_at'), _dec28 = (0, _decorators.field)('scored_with_v3'), _dec29 = (0, _decorators.field)('subscription_read'), _dec30 = (0, _decorators.field)('subscription_read_at'), _dec31 = (0, _decorators.date)('created_at'), _dec32 = (0, _decorators.date)('first_pub_date'), _dec33 = (0, _decorators.children)('article_suggestion_facts'), _class = (_ArticleSuggestion = class ArticleSuggestion extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "articleId", _descriptor, this);
    _initializerDefineProperty(this, "clusterMembershipsJson", _descriptor2, this);
    _initializerDefineProperty(this, "relevance", _descriptor3, this);
    _initializerDefineProperty(this, "reason", _descriptor4, this);
    _initializerDefineProperty(this, "status", _descriptor5, this);
    _initializerDefineProperty(this, "countryCode", _descriptor6, this);
    _initializerDefineProperty(this, "languageCode", _descriptor7, this);
    _initializerDefineProperty(this, "publicationName", _descriptor8, this);
    _initializerDefineProperty(this, "titleEn", _descriptor9, this);
    _initializerDefineProperty(this, "titleOriginal", _descriptor0, this);
    _initializerDefineProperty(this, "descriptionEn", _descriptor1, this);
    _initializerDefineProperty(this, "articleUrl", _descriptor10, this);
    _initializerDefineProperty(this, "imageUrl", _descriptor11, this);
    _initializerDefineProperty(this, "matchedTopicTextsJson", _descriptor12, this);
    // ── Persona v3 (schema v37) scorer inputs + audit ──────────────
    // Hydration-carried article metadata (nullable until the server tagging
    // pipeline backfills; absence routes the engine to the backstop path).
    _initializerDefineProperty(this, "geoTagsJson", _descriptor13, this);
    _initializerDefineProperty(this, "entitiesJson", _descriptor14, this);
    _initializerDefineProperty(this, "eventType", _descriptor15, this);
    _initializerDefineProperty(this, "category", _descriptor16, this);
    _initializerDefineProperty(this, "maxClusterSize", _descriptor17, this);
    _initializerDefineProperty(this, "stableClusterId", _descriptor18, this);
    // null = topic-retrieved; 'CITY'|'COUNTRY'|'GLOBAL' for top-headline injection.
    _initializerDefineProperty(this, "headlineScope", _descriptor19, this);
    // Uppercase ISO country code the COUNTRY-scope headline came from (schema
    // v48). null for topic-retrieved rows and for GLOBAL headlines.
    _initializerDefineProperty(this, "headlineCountryCode", _descriptor20, this);
    // [{ topicId, text, vectorScore? }] — inverted per-topic matchMeta.
    _initializerDefineProperty(this, "matchedTopicsJson", _descriptor21, this);
    // Server story id; equal non-null keys are the same story (schema v56).
    _initializerDefineProperty(this, "storyKey", _descriptor22, this);
    // Deterministic engine raw score (pre-judge) — the fail-open source of truth.
    _initializerDefineProperty(this, "computedScore", _descriptor23, this);
    // Final post-judge raw score (for within-section ordering / audit).
    _initializerDefineProperty(this, "rawScore", _descriptor24, this);
    // Full RelevanceComponents breakdown (audit + judge context).
    _initializerDefineProperty(this, "scoreComponentsJson", _descriptor25, this);
    // Schema v41: epoch ms the row was scored (math persisted). Null
    // while unscored. Feeds the fact-rows selector's "added" ordering.
    _initializerDefineProperty(this, "scoredAt", _descriptor26, this);
    // Epoch ms an attempt finished with no score for this row (schema v57).
    _initializerDefineProperty(this, "scoreFailedAt", _descriptor27, this);
    // Scorer VINTAGE (schema v50): did relevance v3 produce this row's
    // `relevance`? NULL/false = legacy v1 vintage. Read by `gateForRow`
    // (lib/stores/fact-rows-selector.ts) so the render gate is applied per row —
    // v1 and v3 scores are not on the same scale, so one global gate silently
    // deletes rows the other scorer was never judged against.
    _initializerDefineProperty(this, "scoredWithV3", _descriptor28, this);
    // Subscription read (schema v54): how a publication the USER PAYS FOR
    // covered this story, written by `lib/mera-protocol/stage-subscription-read.ts`.
    // Built from the sibling's title, `descriptionEn` and existing enrichment
    // only — the body is paywalled and never fetched, so nothing derived from
    // this may be phrased as having read the article.
    //
    // NULL is the normal resting state, NOT a pending one: most rows have no
    // subscribed sibling and never will, so the UI renders the card without a
    // read line rather than a spinner.
    _initializerDefineProperty(this, "subscriptionRead", _descriptor29, this);
    _initializerDefineProperty(this, "subscriptionReadAt", _descriptor30, this);
    _initializerDefineProperty(this, "createdAt", _descriptor31, this);
    _initializerDefineProperty(this, "firstPubDate", _descriptor32, this);
    _initializerDefineProperty(this, "factLinks", _descriptor33, this);
  }
}, _ArticleSuggestion.table = 'article_suggestions', _ArticleSuggestion.associations = {
  article_suggestion_facts: {
    type: 'has_many',
    foreignKey: 'article_suggestion_id'
  }
}, _ArticleSuggestion), _descriptor = _applyDecoratedDescriptor(_class.prototype, "articleId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "clusterMembershipsJson", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "relevance", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "reason", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "countryCode", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "languageCode", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "publicationName", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "titleEn", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "titleOriginal", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor1 = _applyDecoratedDescriptor(_class.prototype, "descriptionEn", [_dec1], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor10 = _applyDecoratedDescriptor(_class.prototype, "articleUrl", [_dec10], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor11 = _applyDecoratedDescriptor(_class.prototype, "imageUrl", [_dec11], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor12 = _applyDecoratedDescriptor(_class.prototype, "matchedTopicTextsJson", [_dec12], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor13 = _applyDecoratedDescriptor(_class.prototype, "geoTagsJson", [_dec13], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor14 = _applyDecoratedDescriptor(_class.prototype, "entitiesJson", [_dec14], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor15 = _applyDecoratedDescriptor(_class.prototype, "eventType", [_dec15], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor16 = _applyDecoratedDescriptor(_class.prototype, "category", [_dec16], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor17 = _applyDecoratedDescriptor(_class.prototype, "maxClusterSize", [_dec17], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor18 = _applyDecoratedDescriptor(_class.prototype, "stableClusterId", [_dec18], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor19 = _applyDecoratedDescriptor(_class.prototype, "headlineScope", [_dec19], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor20 = _applyDecoratedDescriptor(_class.prototype, "headlineCountryCode", [_dec20], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor21 = _applyDecoratedDescriptor(_class.prototype, "matchedTopicsJson", [_dec21], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor22 = _applyDecoratedDescriptor(_class.prototype, "storyKey", [_dec22], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor23 = _applyDecoratedDescriptor(_class.prototype, "computedScore", [_dec23], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor24 = _applyDecoratedDescriptor(_class.prototype, "rawScore", [_dec24], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor25 = _applyDecoratedDescriptor(_class.prototype, "scoreComponentsJson", [_dec25], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor26 = _applyDecoratedDescriptor(_class.prototype, "scoredAt", [_dec26], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor27 = _applyDecoratedDescriptor(_class.prototype, "scoreFailedAt", [_dec27], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor28 = _applyDecoratedDescriptor(_class.prototype, "scoredWithV3", [_dec28], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor29 = _applyDecoratedDescriptor(_class.prototype, "subscriptionRead", [_dec29], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor30 = _applyDecoratedDescriptor(_class.prototype, "subscriptionReadAt", [_dec30], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor31 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec31], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor32 = _applyDecoratedDescriptor(_class.prototype, "firstPubDate", [_dec32], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor33 = _applyDecoratedDescriptor(_class.prototype, "factLinks", [_dec33], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);