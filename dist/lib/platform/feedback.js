"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.submitFeatureRequest = submitFeatureRequest;
var _index = require("./index");
// Stands in for the app's lib/feedback. A host without a feedback sink reports nothing sent.

function submitFeatureRequest(title, summary) {
  return (0, _index.platform)('feedback').submitFeatureRequest?.(title, summary) ?? false;
}