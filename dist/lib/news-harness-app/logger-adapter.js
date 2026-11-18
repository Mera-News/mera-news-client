"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.appHarnessLogger = void 0;
var _logger = _interopRequireDefault(require("../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// App-side adapter that satisfies the harness's HarnessLogger port using the
// real (Sentry-backed) lib/logger. Lives OUTSIDE lib/news-harness/ so the
// harness directory itself never imports @sentry/react-native.

const appHarnessLogger = exports.appHarnessLogger = {
  debug: (msg, ctx) => _logger.default.debug(msg, ctx),
  info: (msg, ctx) => _logger.default.info(msg, ctx),
  warn: (msg, ctx) => _logger.default.warn(msg, ctx),
  error: (msg, ctx) => _logger.default.error(msg, undefined, ctx)
};