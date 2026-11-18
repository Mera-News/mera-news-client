"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _TranslationCache;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * One machine translation of a piece of server English text into one target
 * language, produced by the OS translator.
 *
 * DERIVED state — safe to sweep, safe to lose. The row `id` is
 * `${sourceHash}:${targetLang}` (see `translation-cache-service`), so lookups
 * are primary-key hits. `sourceText` is kept in full and compared on read, so a
 * hash collision degrades to a cache miss rather than a wrong translation.
 */
let TranslationCache = exports.default = (_dec = (0, _decorators.field)('source_hash'), _dec2 = (0, _decorators.field)('target_lang'), _dec3 = (0, _decorators.text)('source_text'), _dec4 = (0, _decorators.text)('translated_text'), _dec5 = (0, _decorators.date)('created_at'), _dec6 = (0, _decorators.date)('last_used_at'), _class = (_TranslationCache = class TranslationCache extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "sourceHash", _descriptor, this);
    _initializerDefineProperty(this, "targetLang", _descriptor2, this);
    _initializerDefineProperty(this, "sourceText", _descriptor3, this);
    _initializerDefineProperty(this, "translatedText", _descriptor4, this);
    _initializerDefineProperty(this, "createdAt", _descriptor5, this);
    _initializerDefineProperty(this, "lastUsedAt", _descriptor6, this);
  }
}, _TranslationCache.table = 'translation_cache', _TranslationCache), _descriptor = _applyDecoratedDescriptor(_class.prototype, "sourceHash", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "targetLang", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "sourceText", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "translatedText", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "lastUsedAt", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);