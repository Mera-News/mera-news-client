"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _PublicationVisit;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
let PublicationVisit = exports.default = (_dec = (0, _decorators.field)('publication_name'), _dec2 = (0, _decorators.field)('country_code'), _dec3 = (0, _decorators.field)('article_id'), _dec4 = (0, _decorators.field)('article_suggestion_id'), _dec5 = (0, _decorators.field)('article_url'), _dec6 = (0, _decorators.field)('title_en'), _dec7 = (0, _decorators.field)('title_original'), _dec8 = (0, _decorators.field)('language_code'), _dec9 = (0, _decorators.field)('image_url'), _dec0 = (0, _decorators.date)('pub_date'), _dec1 = (0, _decorators.date)('visited_at'), _class = (_PublicationVisit = class PublicationVisit extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "publicationName", _descriptor, this);
    _initializerDefineProperty(this, "countryCode", _descriptor2, this);
    _initializerDefineProperty(this, "articleId", _descriptor3, this);
    _initializerDefineProperty(this, "articleSuggestionId", _descriptor4, this);
    _initializerDefineProperty(this, "articleUrl", _descriptor5, this);
    _initializerDefineProperty(this, "titleEn", _descriptor6, this);
    _initializerDefineProperty(this, "titleOriginal", _descriptor7, this);
    _initializerDefineProperty(this, "languageCode", _descriptor8, this);
    _initializerDefineProperty(this, "imageUrl", _descriptor9, this);
    _initializerDefineProperty(this, "pubDate", _descriptor0, this);
    _initializerDefineProperty(this, "visitedAt", _descriptor1, this);
  }
}, _PublicationVisit.table = 'publication_visits', _PublicationVisit), _descriptor = _applyDecoratedDescriptor(_class.prototype, "publicationName", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "countryCode", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "articleId", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "articleSuggestionId", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "articleUrl", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "titleEn", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "titleOriginal", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "languageCode", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "imageUrl", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "pubDate", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor1 = _applyDecoratedDescriptor(_class.prototype, "visitedAt", [_dec1], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);