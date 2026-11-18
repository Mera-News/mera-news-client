"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addBreadcrumb = addBreadcrumb;
exports.captureException = captureException;
exports.captureMessage = captureMessage;
exports.setExtra = setExtra;
exports.setTag = setTag;
exports.setUser = setUser;
exports.startInactiveSpan = startInactiveSpan;
exports.withScope = withScope;
var _index = require("./index");
// Stands in for '@sentry/react-native' (`import * as Sentry from '@/lib/platform/sentry'`).

const sentry = () => (0, _index.platform)('sentry').sentry;
function captureException(exception, context) {
  return sentry().captureException(exception, context);
}
function captureMessage(message, context) {
  return sentry().captureMessage(message, context);
}
function addBreadcrumb(breadcrumb) {
  sentry().addBreadcrumb(breadcrumb);
}
function setUser(user) {
  sentry().setUser(user);
}
function setTag(key, value) {
  sentry().setTag(key, value);
}
function setExtra(key, value) {
  sentry().setExtra(key, value);
}
function startInactiveSpan(options) {
  return sentry().startInactiveSpan(options);
}
function withScope(callback) {
  sentry().withScope(callback);
}