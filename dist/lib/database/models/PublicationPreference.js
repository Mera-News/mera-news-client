"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _PublicationPreference;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * Persona v3 preferred / blocked publication. Long-lived, user-owned. Matched
 * by `publication_name`. Weights are only ever written explicitly (no implicit
 * dwell signal): >0 boost, <0 dampen, -1 ≈ block.
 */
/**
 * source-pref v47. The discriminator that turns a row from a
 * NAMED-PUBLICATION preference into a LIVE SCOPE: `scopeKind === 'country'`
 * means the row matches any source whose `country_code` equals `scopeValue`
 * (ISO alpha-3), evaluated at render time rather than expanded into rows.
 *
 * `null`/undefined `scopeKind` ⇒ a named-publication row (every pre-v47 row).
 * Only `'country'` exists: `category` is deliberately NOT a scope kind — it is
 * the PUBLICATION's category and 63% of sources share two generic values, so
 * it cannot express "sources like this one".
 */
let PublicationPreference = exports.default = (_dec = (0, _decorators.text)('publication_name'), _dec2 = (0, _decorators.field)('source_country_code'), _dec3 = (0, _decorators.field)('scope_kind'), _dec4 = (0, _decorators.field)('scope_value'), _dec5 = (0, _decorators.field)('weight'), _dec6 = (0, _decorators.field)('status'), _dec7 = (0, _decorators.field)('provenance'), _dec8 = (0, _decorators.date)('created_at'), _dec9 = (0, _decorators.date)('updated_at'), _class = (_PublicationPreference = class PublicationPreference extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    /** Display label. For a scope row this is the human name ("India"), NOT a
     *  publication — every name-matching site must skip rows with a `scopeKind`. */
    _initializerDefineProperty(this, "publicationName", _descriptor, this);
    _initializerDefineProperty(this, "sourceCountryCode", _descriptor2, this);
    _initializerDefineProperty(this, "scopeKind", _descriptor3, this);
    _initializerDefineProperty(this, "scopeValue", _descriptor4, this);
    _initializerDefineProperty(this, "weight", _descriptor5, this);
    _initializerDefineProperty(this, "status", _descriptor6, this);
    _initializerDefineProperty(this, "provenance", _descriptor7, this);
    _initializerDefineProperty(this, "createdAt", _descriptor8, this);
    _initializerDefineProperty(this, "updatedAt", _descriptor9, this);
  }
}, _PublicationPreference.table = 'publication_preferences', _PublicationPreference), _descriptor = _applyDecoratedDescriptor(_class.prototype, "publicationName", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "sourceCountryCode", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "scopeKind", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "scopeValue", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "weight", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "provenance", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "updatedAt", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);