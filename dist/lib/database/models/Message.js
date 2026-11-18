"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _Message;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * A single durable chat message belonging to a Conversation.
 *
 * `toolCallsJson` and `suggestedOptionsJson` are JSON-encoded strings parsed by
 * the conversation service (kept as raw strings on the model so a corrupt value
 * can be tolerated at read time rather than throwing inside a decorator).
 */
let Message = exports.default = (_dec = (0, _decorators.field)('conversation_id'), _dec2 = (0, _decorators.field)('role'), _dec3 = (0, _decorators.field)('content'), _dec4 = (0, _decorators.field)('suggested_options_json'), _dec5 = (0, _decorators.field)('tool_calls_json'), _dec6 = (0, _decorators.date)('created_at'), _class = (_Message = class Message extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "conversationId", _descriptor, this);
    _initializerDefineProperty(this, "role", _descriptor2, this);
    _initializerDefineProperty(this, "content", _descriptor3, this);
    /** Holds only conversation-service's failed mark now. */
    _initializerDefineProperty(this, "suggestedOptionsJson", _descriptor4, this);
    _initializerDefineProperty(this, "toolCallsJson", _descriptor5, this);
    _initializerDefineProperty(this, "createdAt", _descriptor6, this);
  }
}, _Message.table = 'messages', _Message.associations = {
  conversations: {
    type: 'belongs_to',
    key: 'conversation_id'
  }
}, _Message), _descriptor = _applyDecoratedDescriptor(_class.prototype, "conversationId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "role", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "content", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "suggestedOptionsJson", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "toolCallsJson", [_dec5], {
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