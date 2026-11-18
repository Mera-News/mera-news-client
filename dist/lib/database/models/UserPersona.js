"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _decorators = require("@nozbe/watermelondb/decorators");
var _dec, _dec2, _dec3, _dec4, _dec5, _dec6, _dec7, _dec8, _dec9, _dec0, _dec1, _dec10, _class, _descriptor, _descriptor2, _descriptor3, _descriptor4, _descriptor5, _descriptor6, _descriptor7, _descriptor8, _descriptor9, _descriptor0, _descriptor1, _descriptor10, _UserPersona;
function _initializerDefineProperty(e, i, r, l) { r && Object.defineProperty(e, i, { enumerable: r.enumerable, configurable: r.configurable, writable: r.writable, value: r.initializer ? r.initializer.call(l) : void 0 }); }
function _applyDecoratedDescriptor(i, e, r, n, l) { var a = {}; return Object.keys(n).forEach(function (i) { a[i] = n[i]; }), a.enumerable = !!a.enumerable, a.configurable = !!a.configurable, ("value" in a || a.initializer) && (a.writable = !0), a = r.slice().reverse().reduce(function (r, n) { return n(i, e, r) || r; }, a), l && void 0 !== a.initializer && (a.value = a.initializer ? a.initializer.call(l) : void 0, a.initializer = void 0), void 0 === a.initializer ? (Object.defineProperty(i, e, a), null) : a; }
function _initializerWarningHelper(r, e) { throw Error("Decorating class property failed. Please ensure that transform-class-properties is enabled and runs after the decorators transform."); }
const sanitizeJsonArray = raw => Array.isArray(raw) ? raw : [];
let UserPersona = exports.default = (_dec = (0, _decorators.field)('server_id'), _dec2 = (0, _decorators.field)('user_id'), _dec3 = (0, _decorators.field)('processing_mode'), _dec4 = (0, _decorators.field)('onboarding_stage'), _dec5 = (0, _decorators.field)('blocked_by_llm'), _dec6 = (0, _decorators.field)('blocked_by_llm_reason'), _dec7 = (0, _decorators.field)('llm_warning_count'), _dec8 = (0, _decorators.field)('notifications_enabled'), _dec9 = (0, _decorators.json)('preferred_notification_window_json', sanitizeJsonArray), _dec0 = (0, _decorators.json)('language_codes_json', sanitizeJsonArray), _dec1 = (0, _decorators.date)('created_at'), _dec10 = (0, _decorators.date)('updated_at'), _class = (_UserPersona = class UserPersona extends _watermelondb.Model {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, "serverId", _descriptor, this);
    _initializerDefineProperty(this, "userId", _descriptor2, this);
    _initializerDefineProperty(this, "processingMode", _descriptor3, this);
    _initializerDefineProperty(this, "onboardingStage", _descriptor4, this);
    _initializerDefineProperty(this, "blockedByLlm", _descriptor5, this);
    _initializerDefineProperty(this, "blockedByLlmReason", _descriptor6, this);
    _initializerDefineProperty(this, "llmWarningCount", _descriptor7, this);
    _initializerDefineProperty(this, "notificationsEnabled", _descriptor8, this);
    _initializerDefineProperty(this, "preferredNotificationWindow", _descriptor9, this);
    _initializerDefineProperty(this, "languageCodes", _descriptor0, this);
    _initializerDefineProperty(this, "createdAt", _descriptor1, this);
    _initializerDefineProperty(this, "updatedAt", _descriptor10, this);
  }
}, _UserPersona.table = 'user_personas', _UserPersona), _descriptor = _applyDecoratedDescriptor(_class.prototype, "serverId", [_dec], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, "userId", [_dec2], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor3 = _applyDecoratedDescriptor(_class.prototype, "processingMode", [_dec3], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor4 = _applyDecoratedDescriptor(_class.prototype, "onboardingStage", [_dec4], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor5 = _applyDecoratedDescriptor(_class.prototype, "blockedByLlm", [_dec5], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor6 = _applyDecoratedDescriptor(_class.prototype, "blockedByLlmReason", [_dec6], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor7 = _applyDecoratedDescriptor(_class.prototype, "llmWarningCount", [_dec7], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor8 = _applyDecoratedDescriptor(_class.prototype, "notificationsEnabled", [_dec8], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor9 = _applyDecoratedDescriptor(_class.prototype, "preferredNotificationWindow", [_dec9], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor0 = _applyDecoratedDescriptor(_class.prototype, "languageCodes", [_dec0], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor1 = _applyDecoratedDescriptor(_class.prototype, "createdAt", [_dec1], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _descriptor10 = _applyDecoratedDescriptor(_class.prototype, "updatedAt", [_dec10], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: null
}), _class);