"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.SUPPRESSION_KINDS = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _PersonaSuppression;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
/**
 * Persona v3 negative preference / show-less escalation. Long-lived,
 * user-owned. `strength` ≥ 0.8 → hard filter, else a score penalty. Soft ones
 * decay via `expires_at`.
 */

/**
 * What a suppression matches against (schema v46). A NULL `kind` column reads
 * as 'keyword' (see suppression-service.kindOf) so pre-v46 rows are unchanged.
 *
 *  - keyword     → normalized substring over title + description + entities
 *                  (the historical behaviour; driven by `keywords`)
 *  - category    → article.category, exact normalized equality
 *  - event_type  → article.eventType, exact normalized equality
 *  - entity      → any of article.entities, exact normalized equality
 *  - publication → article.publicationName, exact normalized equality
 *  - place       → any of article.geoTags (city/region/countryCode)
 *  - topic       → any matched topic's text, exact normalized equality
 *
 * Every kind except `keyword` compares against the single `value` column.
 */
const SUPPRESSION_KINDS = exports.SUPPRESSION_KINDS = ['keyword', 'category', 'event_type', 'entity', 'publication', 'place', 'topic'];
const sanitizeKeywords = raw => Array.isArray(raw) ? raw.filter(k => typeof k === 'string') : [];
let PersonaSuppression = exports.default = (_dec = (0, _decorators.text)('pattern'), _dec2 = (0, _decorators.json)('keywords_json', sanitizeKeywords), _dec3 = (0, _decorators.field)('strength'), _dec4 = (0, _decorators.field)('source'), _dec5 = (0, _decorators.field)('status'), _dec6 = (0, _decorators.field)('expires_at'), _dec7 = (0, _decorators.date)('created_at'), _dec8 = (0, _decorators.field)('kind'), _dec9 = (0, _decorators.field)('value'), _class = (_PersonaSuppression = class PersonaSuppression extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "pattern", _descriptor, this);
    _initializerDefineProperty(this, "keywords", _descriptor2, this);
    _initializerDefineProperty(this, "strength", _descriptor3, this);
    _initializerDefineProperty(this, "source", _descriptor4, this);
    _initializerDefineProperty(this, "status", _descriptor5, this);
    _initializerDefineProperty(this, "expiresAt", _descriptor6, this);
    _initializerDefineProperty(this, "createdAt", _descriptor7, this);
    /** v46. NULL ⇒ 'keyword' (resolve via suppression-service.kindOf). */
    _initializerDefineProperty(this, "kind", _descriptor8, this);
    /** v46. The token the non-keyword kinds compare against. NULL for keyword. */
    _initializerDefineProperty(this, "value", _descriptor9, this);
  }
}, _PersonaSuppression.table = 'persona_suppressions', _PersonaSuppression), _descriptor = _applyDecoratedDescriptor(_class.prototype, "pattern", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "keywords", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "strength", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "source", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "expiresAt", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "kind", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "value", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);