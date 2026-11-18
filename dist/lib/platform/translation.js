"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.bumpTranslationEpoch = bumpTranslationEpoch;
exports.canTranslateIntoLanguage = canTranslateIntoLanguage;
exports.clearTranslationFailuresFor = clearTranslationFailuresFor;
exports.setLateTranslationSink = setLateTranslationSink;
var _index = require("./index");
// Stands in for the app's lib/translation-service and lib/translation-queue (the OS translator).
// A host without one can translate into nothing, and the other calls do nothing.

function canTranslateIntoLanguage(targetLangCode, osMajorOverride) {
  return (0, _index.platform)('translation').canTranslateIntoLanguage?.(targetLangCode, osMajorOverride) ?? false;
}
function clearTranslationFailuresFor(targetLangCode) {
  (0, _index.platform)('translation').clearTranslationFailuresFor?.(targetLangCode);
}
function setLateTranslationSink(sink) {
  (0, _index.platform)('translation').setLateTranslationSink?.(sink);
}

/** Drops the host's queued translations for the old language. Without a host queue there is no epoch: 0. */
function bumpTranslationEpoch(reason) {
  return (0, _index.platform)('translation').bumpTranslationEpoch?.(reason) ?? 0;
}