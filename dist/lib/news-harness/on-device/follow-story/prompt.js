"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TRACK_OPTION_RULES = void 0;
exports.buildFollowStoryPrompt = buildFollowStoryPrompt;
exports.followStoryContext = followStoryContext;
exports.followStoryInstructions = followStoryInstructions;
var _shared = require("../shared");
var _schema = require("./schema");
var _slots = require("../../../harnesses/slots");
var _template = require("../../../harnesses/template");
/** How every on-device track option is written, shared with the article chat. */
const TRACK_OPTION_RULES = exports.TRACK_OPTION_RULES = (0, _template.render)(_slots.DEVICE_SLOTS["follow-story/track-option-rules"], {
  MAX_OPTION_LABEL_WORDS: _schema.MAX_OPTION_LABEL_WORDS,
  MAX_TRACK_SEARCH_WORDS: _schema.MAX_TRACK_SEARCH_WORDS
});
function followStoryInstructions(languageName) {
  const language = (0, _shared.languageLine)(languageName);
  return (0, _template.render)(_slots.DEVICE_SLOTS["follow-story/instructions"], {
    IDENTITY_LINE: _shared.IDENTITY_LINE,
    language
  });
}
function followStoryContext(input) {
  return input.pending ? `Today: ${input.today}\n${input.pending}` : `Today: ${input.today}`;
}
function buildFollowStoryPrompt(context, history, budgetTokens) {
  return (0, _shared.renderPrompt)(`Option rules: ${TRACK_OPTION_RULES}\n\n${followStoryContext(context)}`, history, budgetTokens);
}