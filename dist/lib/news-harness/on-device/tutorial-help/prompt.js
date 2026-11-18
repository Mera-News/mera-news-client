"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildTutorialHelpOnDevicePrompt = buildTutorialHelpOnDevicePrompt;
exports.tutorialHelpInstructions = tutorialHelpInstructions;
var _tutorialHelp = require("../../tutorial-help");
var _shared = require("../shared");
var _slots = require("../../../harnesses/slots");
var _template = require("../../../harnesses/template");
function tutorialHelpInstructions(languageName) {
  const language = (0, _shared.languageLine)(languageName);
  return (0, _template.render)(_slots.DEVICE_SLOTS["tutorial-help/instructions"], {
    IDENTITY_LINE: _shared.IDENTITY_LINE,
    language
  });
}

/** What the guide answer must never get wrong; sent as the prompt, not the instructions. */
const FACTS = _slots.DEVICE_SLOTS["tutorial-help/facts"];
function buildTutorialHelpOnDevicePrompt(route, history, budgetTokens) {
  const where = (0, _tutorialHelp.buildTutorialHelpContext)(route).replace(/<\/?context>/g, '').trim();
  return (0, _shared.renderPrompt)(`${FACTS}\n\n${where}`, history, budgetTokens);
}