"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _Fact;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
const sanitizeMetadata = raw => raw || undefined;

/**
 * Where the most recent topic-generation run for a fact got to.
 *
 * Declared HERE rather than in the toolkit's `types.ts`, whose `Fact` DTO
 * carries the same union inline: the toolkit type must stay self-contained and
 * must never import from `lib/database`. TypeScript is structural, so the two
 * assign freely in both directions.
 *
 * NULL (absent) is a real, common state meaning generation was never asked for.
 * Render it exactly like 'done' — never a spinner, never an error.
 */
let Fact = exports.default = (_dec = (0, _decorators.text)('statement'), _dec2 = (0, _decorators.json)('metadata_json', sanitizeMetadata), _dec3 = (0, _decorators.field)('questionnaire_level'), _dec4 = (0, _decorators.text)('questionnaire_level_category'), _dec5 = (0, _decorators.text)('questionnaire_attribute'), _dec6 = (0, _decorators.field)('weight'), _dec7 = (0, _decorators.field)('topics_status'), _dec8 = (0, _decorators.date)('topics_updated_at'), _dec9 = (0, _decorators.date)('created_at'), _dec0 = (0, _decorators.date)('updated_at'), _class = (_Fact = class Fact extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "statement", _descriptor, this);
    _initializerDefineProperty(this, "metadata", _descriptor2, this);
    _initializerDefineProperty(this, "questionnaireLevel", _descriptor3, this);
    _initializerDefineProperty(this, "questionnaireLevelCategory", _descriptor4, this);
    _initializerDefineProperty(this, "questionnaireAttribute", _descriptor5, this);
    // Persona v3 fact-level weight multiplier. null ⇒ treated as 1.0.
    _initializerDefineProperty(this, "weight", _descriptor6, this);
    // Topic generation progress (v55). NOT authoritative over the `topics` table:
    // it reports the RUN, the table owns what exists. Never gates rendering.
    _initializerDefineProperty(this, "topicsStatus", _descriptor7, this);
    _initializerDefineProperty(this, "topicsUpdatedAt", _descriptor8, this);
    _initializerDefineProperty(this, "createdAt", _descriptor9, this);
    _initializerDefineProperty(this, "updatedAt", _descriptor0, this);
  }
  async updateFact(statement, metadata) {
    await this.update(fact => {
      fact.statement = statement;
      if (metadata !== undefined) {
        fact.metadata = metadata;
      }
    });
  }

  /**
   * Stamp the topic-generation status, touching ONLY those two columns.
   *
   * Deliberately not routed through `updateFact`, which assigns
   * `fact.metadata` WHOLESALE and would clobber `topics`, `topicGenError` and
   * `topicsReviewedAt` for a caller that only wanted to move a status.
   */
  async setTopicsStatus(status, at = new Date()) {
    await this.update(fact => {
      fact.topicsStatus = status;
      fact.topicsUpdatedAt = at;
      fact.updatedAt = at;
    });
  }
  async destroyCascade() {
    // The cascade must be real: topics carry this fact's id, and an orphaned
    // ACTIVE topic keeps fetching and matching feed content for an interest
    // the user deleted — while the Dashboard drops every suggestion it claims
    // (ownership resolution requires the fact snapshot). Measured 2026-08-03:
    // a device with 74 orphaned topics rendered a permanently empty Dashboard.
    const topics = await this.collections.get('topics').query(_watermelondb.Q.where('fact_id', this.id)).fetch();
    await this.batch(this.prepareDestroyPermanently(), ...topics.map(t => t.prepareDestroyPermanently()));
  }
}, _Fact.table = 'facts', _Fact), _descriptor = _applyDecoratedDescriptor(_class.prototype, "statement", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "metadata", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "questionnaireLevel", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "questionnaireLevelCategory", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "questionnaireAttribute", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "weight", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "topicsStatus", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "topicsUpdatedAt", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "updatedAt", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _applyDecoratedDescriptor(_class.prototype, "updateFact", [_decorators.writer], Object.getOwnPropertyDescriptor(_class.prototype, "updateFact"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "setTopicsStatus", [_decorators.writer], Object.getOwnPropertyDescriptor(_class.prototype, "setTopicsStatus"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "destroyCascade", [_decorators.writer], Object.getOwnPropertyDescriptor(_class.prototype, "destroyCascade"), _class.prototype), _class);