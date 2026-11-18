"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FollowStoryOnDeviceAgent = void 0;
var _followStory = require("../../../news-harness/on-device/follow-story");
var _kevSpec = require("../../../news-harness/on-device/follow-story/kev-spec");
var _shared = require("../../../news-harness/on-device/shared");
var _proposals = require("../../../news-harness/core/proposals");
var _floatingChatStore = require("../../../stores/floating-chat-store");
var _FollowStoryAgent = require("../FollowStoryAgent");
var _run = require("./run");
// On-device "follow a story" chat: the reply's options are staged through the
// cloud agent's own proposeTrack executor, so the story card is the same one.
// Route 'kev': Kev decides, the built-in model writes; 'single' is one
// built-in call.

class FollowStoryOnDeviceAgent {
  constructor(userId, opts = {}) {
    this.opts = opts;
    this.onDevice = true;
    this.id = void 0;
    this.cloud = void 0;
    this.cloud = new _FollowStoryAgent.FollowStoryAgent(userId);
    this.id = this.cloud.id;
  }
  async respond(messages) {
    const proposal = _floatingChatStore.useFloatingChatStore.getState().proposal;
    const pending = (0, _shared.describePending)(proposal);
    if ((0, _run.routeOf)('follow', this.opts) === 'kev') {
      const kev = await (0, _run.tryKev)('FollowStoryOnDeviceAgent', () => (0, _kevSpec.runFollowKevTurn)({
        today: (0, _run.today)(),
        pending: pending ? {
          text: pending,
          tapOnly: (0, _proposals.proposalRequiresUserChoice)(proposal)
        } : null,
        languageName: (0, _run.appLanguageName)()
      }, messages, (0, _run.kevPorts)(this.opts)));
      if (kev) return kev;
    }
    const value = await (0, _run.respondStructured)((0, _followStory.followStoryInstructions)((0, _run.appLanguageName)()), _followStory.FOLLOW_STORY_SCHEMA, budget => (0, _followStory.buildFollowStoryPrompt)({
      today: (0, _run.today)(),
      pending
    }, (0, _run.chatTurns)(messages), budget));
    const message = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
    return (0, _followStory.followStoryTurn)(value, {
      message,
      appIsEnglish: (0, _run.appLanguageName)() === 'English'
    });
  }
  moreOptions(req) {
    return (0, _run.moreTrackOptions)(req, this.opts);
  }
  async executeTool(name, input) {
    const out = (await (0, _run.onDeviceTool)(name, input)) ?? (await this.cloud.executeTool(name, input));
    // The parser keeps label and search only, so the phrase rows' roles ride the result.
    const hints = input?.phraseCard;
    return hints ? {
      ...out,
      result: {
        ...out.result,
        ...hints
      }
    } : out;
  }
}
exports.FollowStoryOnDeviceAgent = FollowStoryOnDeviceAgent;