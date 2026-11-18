"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _class, _descriptor, _descriptor2, _descriptor3, _Conversation;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * A durable chat session. `surface` records where the conversation happened
 * (ONBOARDING | CONFIG). Long-lived, user-owned state — never wiped on resync.
 */
let Conversation = exports.default = (_dec = (0, _decorators.field)('surface'), _dec2 = (0, _decorators.date)('created_at'), _dec3 = (0, _decorators.children)('messages'), _class = (_Conversation = class Conversation extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "surface", _descriptor, this);
    _initializerDefineProperty(this, "createdAt", _descriptor2, this);
    _initializerDefineProperty(this, "messages", _descriptor3, this);
  }
}, _Conversation.table = 'conversations', _Conversation.associations = {
  messages: {
    type: 'has_many',
    foreignKey: 'conversation_id'
  }
}, _Conversation), _descriptor = _applyDecoratedDescriptor(_class.prototype, "surface", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "messages", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);