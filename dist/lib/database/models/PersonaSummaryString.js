"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _PersonaSummaryString;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * A natural-language persona summary string (schema v38) — a human-readable
 * one-liner derived from the structured on-device persona, linked back to the
 * facts/topics that produced it.
 *
 * Long-lived, user-owned state. Nothing generates rows yet;
 * this only stands up the table + model ("migrate never wipe" category).
 * Nothing reads these rows yet.
 */
let PersonaSummaryString = exports.default = (_dec = (0, _decorators.field)('text'), _dec2 = (0, _decorators.field)('linked_fact_ids_json'), _dec3 = (0, _decorators.field)('linked_topic_ids_json'), _dec4 = (0, _decorators.date)('generated_at'), _dec5 = (0, _decorators.field)('persona_version'), _dec6 = (0, _decorators.field)('stale'), _class = (_PersonaSummaryString = class PersonaSummaryString extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "text", _descriptor, this);
    _initializerDefineProperty(this, "linkedFactIdsJson", _descriptor2, this);
    _initializerDefineProperty(this, "linkedTopicIdsJson", _descriptor3, this);
    _initializerDefineProperty(this, "generatedAt", _descriptor4, this);
    _initializerDefineProperty(this, "personaVersion", _descriptor5, this);
    _initializerDefineProperty(this, "stale", _descriptor6, this);
  }
}, _PersonaSummaryString.table = 'persona_summary_strings', _PersonaSummaryString), _descriptor = _applyDecoratedDescriptor(_class.prototype, "text", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "linkedFactIdsJson", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "linkedTopicIdsJson", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "generatedAt", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "personaVersion", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "stale", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);