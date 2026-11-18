"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _ArticleSuggestionFact;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
let ArticleSuggestionFact = exports.default = (_dec = (0, _decorators.field)('article_suggestion_id'), _dec2 = (0, _decorators.field)('fact_id'), _dec3 = (0, _decorators.date)('created_at'), _dec4 = (0, _decorators.immutableRelation)('article_suggestions', 'article_suggestion_id'), _dec5 = (0, _decorators.immutableRelation)('facts', 'fact_id'), _class = (_ArticleSuggestionFact = class ArticleSuggestionFact extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "articleSuggestionId", _descriptor, this);
    _initializerDefineProperty(this, "factId", _descriptor2, this);
    _initializerDefineProperty(this, "createdAt", _descriptor3, this);
    _initializerDefineProperty(this, "articleSuggestion", _descriptor4, this);
    _initializerDefineProperty(this, "fact", _descriptor5, this);
  }
}, _ArticleSuggestionFact.table = 'article_suggestion_facts', _ArticleSuggestionFact.associations = {
  article_suggestions: {
    type: 'belongs_to',
    key: 'article_suggestion_id'
  },
  facts: {
    type: 'belongs_to',
    key: 'fact_id'
  }
}, _ArticleSuggestionFact), _descriptor = _applyDecoratedDescriptor(_class.prototype, "articleSuggestionId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "factId", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "articleSuggestion", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "fact", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);