"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _FactCheckRecord;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * One fact check the user asked for, stored on THIS device.
 *
 * The check is asynchronous: the app fires the request and stops (there is no
 * client poll any more — see `lib/fact-check/use-fact-check.ts`), and the
 * answer typically lands minutes later, via push, long after the reader closed
 * the article. This row is where it lands, and it is what the Dashboard's
 * "Fact checks" block and the /logged-in/fact-checks list read.
 *
 * `payloadJson` holds the WHOLE server row — claims, citations and the
 * `checkedBy` organisations — serialized verbatim. `status`/`verdict` are
 * mirrored out of it so a list can be sorted and filtered without parsing every
 * payload.
 */
let FactCheckRecord = exports.default = (_dec = (0, _decorators.field)('article_id'), _dec2 = (0, _decorators.field)('fact_check_id'), _dec3 = (0, _decorators.text)('article_title'), _dec4 = (0, _decorators.field)('status'), _dec5 = (0, _decorators.field)('verdict'), _dec6 = (0, _decorators.text)('payload_json'), _dec7 = (0, _decorators.date)('requested_at'), _dec8 = (0, _decorators.date)('resolved_at'), _dec9 = (0, _decorators.text)('claim'), _dec0 = (0, _decorators.field)('claim_key'), _class = (_FactCheckRecord = class FactCheckRecord extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "articleId", _descriptor, this);
    _initializerDefineProperty(this, "factCheckId", _descriptor2, this);
    _initializerDefineProperty(this, "articleTitle", _descriptor3, this);
    _initializerDefineProperty(this, "status", _descriptor4, this);
    _initializerDefineProperty(this, "verdict", _descriptor5, this);
    _initializerDefineProperty(this, "payloadJson", _descriptor6, this);
    _initializerDefineProperty(this, "requestedAt", _descriptor7, this);
    _initializerDefineProperty(this, "resolvedAt", _descriptor8, this);
    /**
     * v52 — per-claim identity.
     *
     * `claim` is the verbatim assertion the user picked out of the claim
     * picker's options; `claimKey` is its normalised hash and the second half of
     * the upsert key `(article_id, claim_key)`.
     *
     * BOTH ARE NULL ON A v51 ROW, and that null is meaningful rather than
     * missing: it marks a legacy whole-article check, which keeps its own slot
     * because a keyed lookup can never match it.
     */
    _initializerDefineProperty(this, "claim", _descriptor9, this);
    _initializerDefineProperty(this, "claimKey", _descriptor0, this);
  }
}, _FactCheckRecord.table = 'fact_checks', _FactCheckRecord), _descriptor = _applyDecoratedDescriptor(_class.prototype, "articleId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "factCheckId", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "articleTitle", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "verdict", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "payloadJson", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "requestedAt", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "resolvedAt", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "claim", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "claimKey", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);