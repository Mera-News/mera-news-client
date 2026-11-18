"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TutorialHelpOnDeviceAgent = void 0;
var _onDeviceModel = require("../../../platform/on-device-model");
var _thinkStrip = require("../../../algorithms/think-strip");
var _shared = require("../../../news-harness/on-device/shared");
var _tutorialHelp = require("../../../news-harness/on-device/tutorial-help");
var _logger = _interopRequireDefault(require("../../../logger"));
var _run = require("./run");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// On-device tutorial help: plain streamed text, no tools.

class TutorialHelpOnDeviceAgent {
  constructor(userId, /** `tutorials/<chapter>/<slide>` from the chat context. */
  route) {
    this.route = route;
    this.onDevice = true;
    this.id = void 0;
    this.id = `tutorial-help-${userId}`;
  }
  async respond(messages, io) {
    const system = (0, _tutorialHelp.tutorialHelpInstructions)((0, _run.appLanguageName)());
    const prompt = (0, _tutorialHelp.buildTutorialHelpOnDevicePrompt)(this.route, (0, _run.chatTurns)(messages), await (0, _run.promptBudget)(system));
    const strip = (0, _thinkStrip.createThinkStripper)();
    let reply = '';
    for await (const token of (0, _onDeviceModel.inferStream)({
      systemPrompt: system,
      prompt,
      maxTokens: _shared.ON_DEVICE_CHAT_MAX_TOKENS,
      temperature: 0.4
    }, io.signal)) {
      const visible = strip.push(token);
      if (!visible) continue;
      reply += visible;
      io.onText(visible);
    }
    const tail = strip.flush();
    if (tail) {
      reply += tail;
      io.onText(tail);
    }
    return {
      reply,
      calls: []
    };
  }
  async executeTool(name) {
    // Never offered a tool; a name here can only be invented.
    _logger.default.warn('[TutorialHelpOnDeviceAgent] Refused a tool call', {
      name
    });
    return {
      result: {
        error: 'this assistant only explains how mera works and cannot change anything'
      }
    };
  }
}
exports.TutorialHelpOnDeviceAgent = TutorialHelpOnDeviceAgent;