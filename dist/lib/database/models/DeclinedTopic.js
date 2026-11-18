"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _DeclinedTopic;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * A topic the user explicitly said No to (schema v55).
 *
 * User-owned, permanent and backed up. This is a preference, not a cache:
 * losing it means the persona agent re-proposes interests the user already
 * rejected. Removing one is an explicit act (`removeDecline`), and doing so
 * only stops the decline suppressing future proposals — it does NOT resurrect
 * the topic row, which was destroyed when the delete committed.
 *
 * Device-only and never reported. No collection may link a user to a topic
 * server-side, and this is product state rather than behavioural
 * instrumentation.
 *
 * `text` vs `normalizedText`: the first is the display form the "Topics you
 * removed" list renders, the second is the dedup and match key that topic
 * generation filters candidates against. Keying on the normalized form alone
 * would show the user lowercased, whitespace-collapsed strings back.
 */
let DeclinedTopic = exports.default = (_dec = (0, _decorators.text)('text'), _dec2 = (0, _decorators.text)('normalized_text'), _dec3 = (0, _decorators.field)('source_fact_id'), _dec4 = (0, _decorators.date)('created_at'), _class = (_DeclinedTopic = class DeclinedTopic extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "text", _descriptor, this);
    _initializerDefineProperty(this, "normalizedText", _descriptor2, this);
    /** The fact this topic belonged to, when it had one. Location and
     *  tracked-story topics carry no fact, so NULL is a first-class value. */
    _initializerDefineProperty(this, "sourceFactId", _descriptor3, this);
    _initializerDefineProperty(this, "createdAt", _descriptor4, this);
  }
}, _DeclinedTopic.table = 'declined_topics', _DeclinedTopic), _descriptor = _applyDecoratedDescriptor(_class.prototype, "text", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "normalizedText", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "sourceFactId", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);