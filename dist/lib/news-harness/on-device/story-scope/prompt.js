"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.STORY_SCOPE_SYSTEM = void 0;
exports.buildOnDeviceStoryScopePrompt = buildOnDeviceStoryScopePrompt;
var _storyScope = require("../../story-scope");
var _slots = require("../../../harnesses/slots");
// On-device story scope: one followed story's titles to a `{label, search}`
// topic, for the one-shot migration of a legacy follow. The cloud prompt
// (news-harness/story-scope) carries real-world examples, which a small model
// copies; this one describes the shape instead. The user message is the
// cloud one: numbered, sanitised titles and the date.

const STORY_SCOPE_SYSTEM = exports.STORY_SCOPE_SYSTEM = _slots.DEVICE_SLOTS["story-scope/story-scope-system"];
function buildOnDeviceStoryScopePrompt(titles, nowMs) {
  return {
    system: STORY_SCOPE_SYSTEM,
    prompt: (0, _storyScope.buildStoryScopePrompt)(titles, nowMs).user
  };
}