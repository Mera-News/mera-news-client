"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _dec10, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _descriptor10, _Topic;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * Persona v3 weighted granular topic — replaces the `fact.metadata.topics`
 * string list. Long-lived, user-owned. `normalized_text` (lowercase/trim) is
 * the dedup + article-match key. Semantics:
 *   active & weight>0 → retrieved + positively scored
 *   active & weight≤0 → not retrieved; demotes at scoring if the article matches
 *   suppressed        → hard filter
 *   retired           → dedup/history only
 */
let Topic = exports.default = (_dec = (0, _decorators.field)('fact_id'), _dec2 = (0, _decorators.text)('text'), _dec3 = (0, _decorators.text)('normalized_text'), _dec4 = (0, _decorators.field)('weight'), _dec5 = (0, _decorators.field)('status'), _dec6 = (0, _decorators.field)('provenance'), _dec7 = (0, _decorators.field)('high_priority'), _dec8 = (0, _decorators.field)('location_id'), _dec9 = (0, _decorators.field)('last_signal_at'), _dec0 = (0, _decorators.field)('pending_delete_at'), _dec1 = (0, _decorators.date)('created_at'), _dec10 = (0, _decorators.date)('updated_at'), _class = (_Topic = class Topic extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "factId", _descriptor, this);
    _initializerDefineProperty(this, "text", _descriptor2, this);
    _initializerDefineProperty(this, "normalizedText", _descriptor3, this);
    _initializerDefineProperty(this, "weight", _descriptor4, this);
    _initializerDefineProperty(this, "status", _descriptor5, this);
    _initializerDefineProperty(this, "provenance", _descriptor6, this);
    _initializerDefineProperty(this, "highPriority", _descriptor7, this);
    _initializerDefineProperty(this, "locationId", _descriptor8, this);
    _initializerDefineProperty(this, "lastSignalAt", _descriptor9, this);
    /**
     * Staged for deletion (v55). Non-null ⇒ the row still EXISTS but no live read
     * may return it, which is what lets the 5s undo survive the card unmounting,
     * a tab switch and a process kill.
     *
     * NOT a fourth `TopicStatus`: staging is orthogonal to
     * active/suppressed/retired, and folding it in would lose the status the row
     * must be restored to on undo.
     */
    _initializerDefineProperty(this, "pendingDeleteAt", _descriptor0, this);
    _initializerDefineProperty(this, "createdAt", _descriptor1, this);
    _initializerDefineProperty(this, "updatedAt", _descriptor10, this);
  }
}, _Topic.table = 'topics', _Topic), _descriptor = _applyDecoratedDescriptor(_class.prototype, "factId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "text", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "normalizedText", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "weight", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "provenance", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "highPriority", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "locationId", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "lastSignalAt", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "pendingDeleteAt", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor1 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec1], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor10 = _applyDecoratedDescriptor(_class.prototype, "updatedAt", [_dec10], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);