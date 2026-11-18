"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PersonaOnDeviceAgent = void 0;
var _factService = require("../../../database/services/fact-service");
var _personaChat = require("../../../news-harness/on-device/persona-chat");
var _kevSpec = require("../../../news-harness/on-device/persona-chat/kev-spec");
var _shared = require("../../../news-harness/on-device/shared");
var _proposals = require("../../../news-harness/core/proposals");
var _topicPlanNotes = require("../../../news-harness/persona-management/topic-plan-notes");
var _floatingChatStore = require("../../../stores/floating-chat-store");
var _PersonaUpdateAgent = require("../PersonaUpdateAgent");
var _run = require("./run");
// On-device persona chat: facts to offer, facts to remove and a yes or no to a
// waiting change, run through PersonaUpdateAgent's executors. Warnings,
// calibration and config changes are cloud-only. Route 'kev': Kev
// decides, the built-in model writes; 'single' is one built-in call.

class PersonaOnDeviceAgent {
  constructor(userId, surface, opts = {}) {
    this.surface = surface;
    this.opts = opts;
    this.onDevice = true;
    this.id = void 0;
    this.cloud = void 0;
    this.cloud = new _PersonaUpdateAgent.PersonaUpdateAgent(userId, surface);
    this.id = this.cloud.id;
  }
  async respond(messages) {
    const facts = await (0, _factService.getFacts)(); // newest first
    const {
      proposal,
      topicPlanNotes
    } = _floatingChatStore.useFloatingChatStore.getState();
    const context = {
      facts: facts.map(f => ({
        id: f.id,
        statement: f.statement,
        attribute: f.questionnaireAttribute
      })),
      // The same notes the cloud context carries: a hidden discard turn is the
      // first thing history trimming drops, this block is not.
      topicPlanNotes: (0, _topicPlanNotes.formatTopicPlanNotesBlock)(topicPlanNotes),
      pending: (0, _shared.describePending)(proposal)
    };
    if ((0, _run.routeOf)('persona', this.opts) === 'kev') {
      const pending = context.pending ? {
        text: context.pending,
        tapOnly: (0, _proposals.proposalRequiresUserChoice)(proposal)
      } : null;
      const kev = await (0, _run.tryKev)('PersonaOnDeviceAgent', () => (0, _kevSpec.runPersonaKevTurn)({
        surface: this.surface,
        facts: context.facts,
        topicPlanNotes: context.topicPlanNotes,
        pending,
        languageName: (0, _run.appLanguageName)()
      }, messages, (0, _run.kevPorts)(this.opts)));
      if (kev) return kev;
    }
    const value = await (0, _run.respondStructured)((0, _personaChat.personaChatInstructions)(this.surface, (0, _run.appLanguageName)()), (0, _personaChat.personaChatSchema)(this.surface), budget => (0, _personaChat.buildPersonaChatPrompt)(this.surface, context, (0, _run.chatTurns)(messages), budget));
    return (0, _personaChat.personaChatTurn)(value, {
      factIds: (0, _personaChat.shownFactIds)(context),
      hasPending: context.pending != null
    });
  }
  async executeTool(name, input) {
    return (await (0, _run.onDeviceTool)(name, input)) ?? this.cloud.executeTool(name, input);
  }
}
exports.PersonaOnDeviceAgent = PersonaOnDeviceAgent;