"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _ArticleFeedback;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
let ArticleFeedback = exports.default = (_dec = (0, _decorators.field)('article_id'), _dec2 = (0, _decorators.field)('suggestion_id'), _dec3 = (0, _decorators.field)('sentiment'), _dec4 = (0, _decorators.field)('title'), _dec5 = (0, _decorators.field)('origin'), _dec6 = (0, _decorators.field)('surface'), _dec7 = (0, _decorators.field)('context_json'), _dec8 = (0, _decorators.field)('processed_at'), _dec9 = (0, _decorators.date)('created_at'), _class = (_ArticleFeedback = class ArticleFeedback extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "articleId", _descriptor, this);
    _initializerDefineProperty(this, "suggestionId", _descriptor2, this);
    _initializerDefineProperty(this, "sentiment", _descriptor3, this);
    _initializerDefineProperty(this, "title", _descriptor4, this);
    // Origin-aware feedback (schema v38). `origin` = 'suggestion' | 'article',
    // `surface` = the on-screen surface the tap came from, `contextJson` = a JSON
    // snapshot of the FeedbackSubject extras. All nullable — legacy rows written
    // by ArticleFeedbackPrompt leave them null.
    _initializerDefineProperty(this, "origin", _descriptor5, this);
    _initializerDefineProperty(this, "surface", _descriptor6, this);
    _initializerDefineProperty(this, "contextJson", _descriptor7, this);
    // Feed-verdict processing marker (schema v42). Epoch ms; null means "still
    // pending for the 3-hourly digest". It now reads as "not pending"
    // rather than "folded in": a BARE verdict (no context_json.treePath) is
    // stamped at write so it is discarded, and a terminal tree leaf stamps it
    // again right after applying its persona actions on the spot. Only the
    // in-between state — a verdict carrying a part-way tree path — is null.
    _initializerDefineProperty(this, "processedAt", _descriptor8, this);
    _initializerDefineProperty(this, "createdAt", _descriptor9, this);
  }
}, _ArticleFeedback.table = 'article_feedback', _ArticleFeedback), _descriptor = _applyDecoratedDescriptor(_class.prototype, "articleId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "suggestionId", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "sentiment", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "title", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "origin", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "surface", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "contextJson", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "processedAt", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);