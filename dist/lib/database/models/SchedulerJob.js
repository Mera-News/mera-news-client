"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _SchedulerJob;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
let SchedulerJob = exports.default = (_dec = (0, _decorators.field)('task_name'), _dec2 = (0, _decorators.field)('status'), _dec3 = (0, _decorators.field)('input_json'), _dec4 = (0, _decorators.field)('error_code'), _dec5 = (0, _decorators.field)('error_message'), _dec6 = (0, _decorators.field)('attempt'), _dec7 = (0, _decorators.field)('max_attempts'), _dec8 = (0, _decorators.field)('scheduled_at'), _dec9 = (0, _decorators.field)('started_at'), _dec0 = (0, _decorators.field)('completed_at'), _dec1 = (0, _decorators.field)('retry_at'), _class = (_SchedulerJob = class SchedulerJob extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "taskName", _descriptor, this);
    _initializerDefineProperty(this, "status", _descriptor2, this);
    _initializerDefineProperty(this, "inputJson", _descriptor3, this);
    _initializerDefineProperty(this, "errorCode", _descriptor4, this);
    _initializerDefineProperty(this, "errorMessage", _descriptor5, this);
    _initializerDefineProperty(this, "attempt", _descriptor6, this);
    _initializerDefineProperty(this, "maxAttempts", _descriptor7, this);
    _initializerDefineProperty(this, "scheduledAt", _descriptor8, this);
    _initializerDefineProperty(this, "startedAt", _descriptor9, this);
    _initializerDefineProperty(this, "completedAt", _descriptor0, this);
    _initializerDefineProperty(this, "retryAt", _descriptor1, this);
  }
}, _SchedulerJob.table = 'scheduler_jobs', _SchedulerJob), _descriptor = _applyDecoratedDescriptor(_class.prototype, "taskName", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "status", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "inputJson", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "errorCode", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "errorMessage", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "attempt", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "maxAttempts", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "scheduledAt", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "startedAt", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "completedAt", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor1 = _applyDecoratedDescriptor(_class.prototype, "retryAt", [_dec1], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);