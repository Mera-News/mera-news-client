"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _PersonaChangeLog;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * Persona v3 audit / revert log — one row per persona mutation. `action_json`
 * holds enough state ({ before, after, targetId, delta }) to invert the
 * action. Long-lived, user-owned.
 */
let PersonaChangeLog = exports.default = (_dec = (0, _decorators.field)('action_type'), _dec2 = (0, _decorators.text)('action_json'), _dec3 = (0, _decorators.field)('source'), _dec4 = (0, _decorators.text)('summary'), _dec5 = (0, _decorators.field)('reverted'), _dec6 = (0, _decorators.date)('created_at'), _class = (_PersonaChangeLog = class PersonaChangeLog extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "actionType", _descriptor, this);
    _initializerDefineProperty(this, "actionJson", _descriptor2, this);
    _initializerDefineProperty(this, "source", _descriptor3, this);
    _initializerDefineProperty(this, "summary", _descriptor4, this);
    _initializerDefineProperty(this, "reverted", _descriptor5, this);
    _initializerDefineProperty(this, "createdAt", _descriptor6, this);
  }
}, _PersonaChangeLog.table = 'persona_change_log', _PersonaChangeLog), _descriptor = _applyDecoratedDescriptor(_class.prototype, "actionType", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "actionJson", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "source", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "summary", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "reverted", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);