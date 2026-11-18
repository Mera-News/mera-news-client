"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _StoryImpression;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * Persona v3 seen-state. Presentation/dedup ONLY — impressions never mutate
 * topics/facts/locations. One row per `article_id`, with `stable_cluster_id`
 * snapshotted at first impression and `opened` upgraded in place. TTL 30d,
 * pruned by data-cleanup-task.
 */
let StoryImpression = exports.default = (_dec = (0, _decorators.field)('article_id'), _dec2 = (0, _decorators.field)('stable_cluster_id'), _dec3 = (0, _decorators.field)('suggestion_id'), _dec4 = (0, _decorators.text)('title_norm'), _dec5 = (0, _decorators.field)('surface'), _dec6 = (0, _decorators.field)('opened'), _dec7 = (0, _decorators.date)('first_seen_at'), _dec8 = (0, _decorators.date)('last_seen_at'), _dec9 = (0, _decorators.field)('seen_count'), _class = (_StoryImpression = class StoryImpression extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "articleId", _descriptor, this);
    _initializerDefineProperty(this, "stableClusterId", _descriptor2, this);
    _initializerDefineProperty(this, "suggestionId", _descriptor3, this);
    _initializerDefineProperty(this, "titleNorm", _descriptor4, this);
    _initializerDefineProperty(this, "surface", _descriptor5, this);
    _initializerDefineProperty(this, "opened", _descriptor6, this);
    _initializerDefineProperty(this, "firstSeenAt", _descriptor7, this);
    _initializerDefineProperty(this, "lastSeenAt", _descriptor8, this);
    _initializerDefineProperty(this, "seenCount", _descriptor9, this);
  }
}, _StoryImpression.table = 'story_impressions', _StoryImpression), _descriptor = _applyDecoratedDescriptor(_class.prototype, "articleId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "stableClusterId", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "suggestionId", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "titleNorm", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "surface", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "opened", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "firstSeenAt", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "lastSeenAt", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "seenCount", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);