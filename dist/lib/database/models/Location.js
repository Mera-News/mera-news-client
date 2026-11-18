"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _Location;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * Persona v3 role-tagged place entity. Long-lived, user-owned. Never sent in
 * retrieval (privacy-lean) — all geo matching happens on-device. Ordered by
 * `weight` desc. `pinned_for_weather` is reserved for a future WeatherKit
 * widget and unused by scoring.
 */
let Location = exports.default = (_dec = (0, _decorators.text)('city'), _dec2 = (0, _decorators.text)('region'), _dec3 = (0, _decorators.field)('country_code'), _dec4 = (0, _decorators.field)('role'), _dec5 = (0, _decorators.field)('weight'), _dec6 = (0, _decorators.field)('valid_until'), _dec7 = (0, _decorators.field)('pinned_for_weather'), _dec8 = (0, _decorators.field)('provenance'), _dec9 = (0, _decorators.field)('source_fact_id'), _dec0 = (0, _decorators.date)('created_at'), _dec1 = (0, _decorators.date)('updated_at'), _class = (_Location = class Location extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "city", _descriptor, this);
    _initializerDefineProperty(this, "region", _descriptor2, this);
    _initializerDefineProperty(this, "countryCode", _descriptor3, this);
    _initializerDefineProperty(this, "role", _descriptor4, this);
    _initializerDefineProperty(this, "weight", _descriptor5, this);
    _initializerDefineProperty(this, "validUntil", _descriptor6, this);
    _initializerDefineProperty(this, "pinnedForWeather", _descriptor7, this);
    _initializerDefineProperty(this, "provenance", _descriptor8, this);
    _initializerDefineProperty(this, "sourceFactId", _descriptor9, this);
    _initializerDefineProperty(this, "createdAt", _descriptor0, this);
    _initializerDefineProperty(this, "updatedAt", _descriptor1, this);
  }
}, _Location.table = 'locations', _Location), _descriptor = _applyDecoratedDescriptor(_class.prototype, "city", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "region", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "countryCode", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "role", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "weight", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "validUntil", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "pinnedForWeather", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "provenance", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "sourceFactId", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor1 = _applyDecoratedDescriptor(_class.prototype, "updatedAt", [_dec1], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);