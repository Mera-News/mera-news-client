"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _dec10, _dec11, _dec12, _dec13, _dec14, _dec15, _dec16, _dec17, _dec18, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _descriptor10, _descriptor11, _descriptor12, _descriptor13, _descriptor14, _descriptor15, _descriptor16, _descriptor17, _descriptor18, _SavedArticleSuggestion;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * A user-saved article suggestion — a device-local "save for later" snapshot.
 *
 * Unlike `article_suggestions` (an ephemeral 48h feed cache), this table is
 * long-lived, user-owned state with no TTL. Every card-renderable field is
 * copied off the source `ForYouSuggestion` at save time so the row stays fully
 * renderable even after the source feed row is pruned.
 *
 * The WatermelonDB `id` is set to the original ArticleSuggestion server `_id`
 * (via `_raw.id = s._id`) so navigation (`articleSuggestionId`) and de-dup work
 * unchanged. Fact-check retention rows (`origin = 'fact_check'`) are instead
 * keyed by the ARTICLE `_id`, because the article-detail fallback looks rows up
 * by article id.
 */
let SavedArticleSuggestion = exports.default = (_dec = (0, _decorators.field)('article_id'), _dec2 = (0, _decorators.field)('cluster_memberships_json'), _dec3 = (0, _decorators.field)('relevance'), _dec4 = (0, _decorators.field)('reason'), _dec5 = (0, _decorators.field)('relevance_generation_completed'), _dec6 = (0, _decorators.field)('reason_generation_completed'), _dec7 = (0, _decorators.field)('country_code'), _dec8 = (0, _decorators.field)('language_code'), _dec9 = (0, _decorators.field)('publication_name'), _dec0 = (0, _decorators.field)('title_en'), _dec1 = (0, _decorators.field)('title_original'), _dec10 = (0, _decorators.field)('description_en'), _dec11 = (0, _decorators.field)('article_url'), _dec12 = (0, _decorators.field)('image_url'), _dec13 = (0, _decorators.field)('matched_topic_texts_json'), _dec14 = (0, _decorators.field)('origin'), _dec15 = (0, _decorators.field)('archived'), _dec16 = (0, _decorators.date)('created_at'), _dec17 = (0, _decorators.date)('first_pub_date'), _dec18 = (0, _decorators.date)('saved_at'), _class = (_SavedArticleSuggestion = class SavedArticleSuggestion extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "articleId", _descriptor, this);
    _initializerDefineProperty(this, "clusterMembershipsJson", _descriptor2, this);
    _initializerDefineProperty(this, "relevance", _descriptor3, this);
    _initializerDefineProperty(this, "reason", _descriptor4, this);
    _initializerDefineProperty(this, "relevanceGenerationCompleted", _descriptor5, this);
    _initializerDefineProperty(this, "reasonGenerationCompleted", _descriptor6, this);
    _initializerDefineProperty(this, "countryCode", _descriptor7, this);
    _initializerDefineProperty(this, "languageCode", _descriptor8, this);
    _initializerDefineProperty(this, "publicationName", _descriptor9, this);
    _initializerDefineProperty(this, "titleEn", _descriptor0, this);
    _initializerDefineProperty(this, "titleOriginal", _descriptor1, this);
    _initializerDefineProperty(this, "descriptionEn", _descriptor10, this);
    _initializerDefineProperty(this, "articleUrl", _descriptor11, this);
    _initializerDefineProperty(this, "imageUrl", _descriptor12, this);
    _initializerDefineProperty(this, "matchedTopicTextsJson", _descriptor13, this);
    // Origin discriminator (schema v38): 'suggestion' (a saved ForYouSuggestion),
    // 'article' (a standalone NewsArticle), or 'fact_check' (a retention snapshot
    // kept only so a fact-checked article stays openable — hidden from the Saved
    // screen and from bookmark state). Null on pre-v38 rows ⇒ 'suggestion'.
    _initializerDefineProperty(this, "origin", _descriptor14, this);
    // Which Saved list (schema v58): true is Archive, false or null is Read later.
    _initializerDefineProperty(this, "archived", _descriptor15, this);
    _initializerDefineProperty(this, "createdAt", _descriptor16, this);
    _initializerDefineProperty(this, "firstPubDate", _descriptor17, this);
    _initializerDefineProperty(this, "savedAt", _descriptor18, this);
  }
}, _SavedArticleSuggestion.table = 'saved_article_suggestions', _SavedArticleSuggestion), _descriptor = _applyDecoratedDescriptor(_class.prototype, "articleId", [_dec], {
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
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "relevanceGenerationCompleted", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "reasonGenerationCompleted", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "countryCode", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "languageCode", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "publicationName", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "titleEn", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor1 = _applyDecoratedDescriptor(_class.prototype, "titleOriginal", [_dec1], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor10 = _applyDecoratedDescriptor(_class.prototype, "descriptionEn", [_dec10], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor11 = _applyDecoratedDescriptor(_class.prototype, "articleUrl", [_dec11], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor12 = _applyDecoratedDescriptor(_class.prototype, "imageUrl", [_dec12], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor13 = _applyDecoratedDescriptor(_class.prototype, "matchedTopicTextsJson", [_dec13], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor14 = _applyDecoratedDescriptor(_class.prototype, "origin", [_dec14], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor15 = _applyDecoratedDescriptor(_class.prototype, "archived", [_dec15], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor16 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec16], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor17 = _applyDecoratedDescriptor(_class.prototype, "firstPubDate", [_dec17], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor18 = _applyDecoratedDescriptor(_class.prototype, "savedAt", [_dec18], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);