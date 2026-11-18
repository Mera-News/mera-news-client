"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _InferenceJob;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
const sanitizeJson = raw => raw || {};
let InferenceJob = exports.default = (_dec = (0, _decorators.field)('job_type'), _dec2 = (0, _decorators.field)('status'), _dec3 = (0, _decorators.field)('priority'), _dec4 = (0, _decorators.json)('payload_json', sanitizeJson), _dec5 = (0, _decorators.json)('result_json', sanitizeJson), _dec6 = (0, _decorators.field)('error_message'), _dec7 = (0, _decorators.field)('attempts'), _dec8 = (0, _decorators.field)('max_attempts'), _dec9 = (0, _decorators.date)('created_at'), _dec0 = (0, _decorators.date)('updated_at'), _class = (_InferenceJob = class InferenceJob extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "jobType", _descriptor, this);
    _initializerDefineProperty(this, "status", _descriptor2, this);
    _initializerDefineProperty(this, "priority", _descriptor3, this);
    _initializerDefineProperty(this, "payload", _descriptor4, this);
    _initializerDefineProperty(this, "result", _descriptor5, this);
    _initializerDefineProperty(this, "errorMessage", _descriptor6, this);
    _initializerDefineProperty(this, "attempts", _descriptor7, this);
    _initializerDefineProperty(this, "maxAttempts", _descriptor8, this);
    _initializerDefineProperty(this, "createdAt", _descriptor9, this);
    _initializerDefineProperty(this, "updatedAt", _descriptor0, this);
  }
  async markRunning() {
    await this.update(job => {
      job.status = 'running';
      job.attempts = (job.attempts || 0) + 1;
    });
  }
  async markDone(result) {
    await this.update(job => {
      job.status = 'done';
      job.result = result;
    });
  }

  /**
   * A job this bundle cannot run at all (no handler for its type). COUNTS an
   * attempt, which `markFailed` alone does not: the job never reached
   * `markRunning`, so without the increment `attempts` never moves, the job is
   * re-pended on every loop and the queue spins forever. That is exactly what
   * an OTA rollback does to a job type the older bundle has never heard of.
   */
  async markUnrunnable(errorMessage) {
    const attempts = (this.attempts || 0) + 1;
    if (attempts >= this.maxAttempts) {
      await this.destroyPermanently();
      return;
    }
    await this.update(job => {
      job.attempts = attempts;
      job.status = 'pending';
      job.errorMessage = errorMessage;
    });
  }

  /**
   * "Not now" rather than "failed": offline, no local credential, a gateway
   * 503 or a 429. Re-pends and GIVES BACK the attempt `markRunning` took, so an
   * app closed offline cannot burn a job's three attempts on conditions that
   * say nothing about the job. The delay is not stored here (no column, and a
   * schema bump is not worth it): the queue gates the whole job TYPE in memory.
   */
  async markDeferred(reason) {
    await this.update(job => {
      job.status = 'pending';
      job.attempts = Math.max(0, (job.attempts || 0) - 1);
      job.errorMessage = reason;
    });
  }
  async markFailed(errorMessage) {
    if (this.attempts >= this.maxAttempts) {
      await this.destroyPermanently();
      return;
    }
    await this.update(job => {
      job.status = 'pending';
      job.errorMessage = errorMessage;
    });
  }
}, _InferenceJob.table = 'inference_jobs', _InferenceJob), _descriptor = _applyDecoratedDescriptor(_class.prototype, "jobType", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "priority", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "payload", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "result", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "errorMessage", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "attempts", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "maxAttempts", [_dec8], {
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
}), _applyDecoratedDescriptor(_class.prototype, "markRunning", [_decorators.writer], Object.getOwnPropertyDescriptor(_class.prototype, "markRunning"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "markDone", [_decorators.writer], Object.getOwnPropertyDescriptor(_class.prototype, "markDone"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "markUnrunnable", [_decorators.writer], Object.getOwnPropertyDescriptor(_class.prototype, "markUnrunnable"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "markDeferred", [_decorators.writer], Object.getOwnPropertyDescriptor(_class.prototype, "markDeferred"), _class.prototype), _applyDecoratedDescriptor(_class.prototype, "markFailed", [_decorators.writer], Object.getOwnPropertyDescriptor(_class.prototype, "markFailed"), _class.prototype), _class);