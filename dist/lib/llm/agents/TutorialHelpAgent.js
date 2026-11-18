"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TutorialHelpAgent = void 0;
var _webSearchHandler = require("../../chat-tools/web-search-handler");
var _chatCloud = require("../chat-cloud");
var _cloudComplete = require("../cloudComplete");
var _tutorialHelp = require("../../news-harness/tutorial-help");
var _logger = _interopRequireDefault(require("../../logger"));
var _meraProtocolStore = require("../../stores/mera-protocol-store");
var _appLanguageStore = require("../../stores/app-language-store");
var _supportedLanguages = require("../../supported-languages");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// TutorialHelpAgent — implements IAgent for the "Ask Mera" button on a tutorial
// slide. Product help, and nothing else.
//
// It is the thin RN adapter over lib/news-harness/tutorial-help: prompt and
// context construction live in that RN-free brain, and everything that touches
// Zustand or the logger lives here.
//
// ⚠️ THE POINT OF THIS CLASS IS STILL WHAT IT DOES NOT HAVE.
// `agent-registry.ts` used to route `{ kind: 'generic' }` to
// `PersonaUpdateAgent`, which is told to redirect off-profile questions AND to
// emit at least one `saveExtractedFacts` per turn. A tutorial question would
// therefore be deflected and would silently write to the reader's profile — a
// failure that LOOKS like success (the popover morphs, a reply streams).
//
// `webSearch` — read-only, CLOUD-only, behind the user's toggle — is the ONE
// tool this agent now carries, so a reader who asks about something outside the
// app gets an answer instead of a shrug. Nothing about the original failure is
// reopened by it: `saveExtractedFacts` is still absent, so is every other
// mutating tool, and every name
// this class is not offering is still refused below.

class TutorialHelpAgent {
  constructor(userId, /** `tutorials/<chapter>/<slide>` from the chat context. */
  route) {
    this.userId = userId;
    this.route = route;
    this.id = void 0;
    // --- IAgent: system prompt (static — cacheable by KV cache) ---
    this.cachedSystemPrompt = null;
    this.lastLanguageName = null;
    this.lastWebSearch = null;
    this.id = `tutorial-help-${userId}`;
  }
  /** CLOUD + the user's toggle. The LOCAL turn is one-shot (`useLocalLLM` never
   *  pushes a `role:'tool'` message back), so a search the model can never read
   *  is strictly worse than no tool. */
  webSearchEnabled() {
    const protocol = _meraProtocolStore.useMeraProtocolStore.getState();
    return (0, _chatCloud.chatRunsInCloud)() && (0, _cloudComplete.usesGateway)() && protocol.webSearchInChat === true;
  }
  async buildSystemPrompt() {
    const appLanguage = _appLanguageStore.useAppLanguageStore.getState().appLanguage;
    const languageName = _supportedLanguages.SUPPORTED_LANGUAGES.find(l => l.code === appLanguage)?.name ?? 'English';
    const webSearch = this.webSearchEnabled();

    // webSearch IS PART OF THE CACHE KEY. Without it the cached prompt keeps
    // saying "you have no tools at all" after the user turns the toggle on,
    // while getToolDefinitions() hands the model a tool — the "toggle on, still
    // refuses" shape already reported against ArticleFeedbackAgent.
    if (this.cachedSystemPrompt && this.lastLanguageName === languageName && this.lastWebSearch === webSearch) {
      return this.cachedSystemPrompt;
    }

    // `needsToolFormat` is deliberately ignored. On LOCAL there are no tools at
    // all, so there is no XML tool-call block to append — and teaching a model
    // a call format it has nothing to call with is the fastest way to get a
    // hallucinated tool call.
    this.cachedSystemPrompt = (0, _tutorialHelp.buildTutorialHelpPrompt)({
      languageName,
      webSearch
    });
    this.lastLanguageName = languageName;
    this.lastWebSearch = webSearch;
    return this.cachedSystemPrompt;
  }

  // --- IAgent: dynamic context (rebuilt every turn) ---

  async buildContext() {
    return (0, _tutorialHelp.buildTutorialHelpContext)(this.route);
  }

  // --- IAgent: tools ---

  /** `webSearch` and nothing else, and only on CLOUD with the toggle on. Every
   *  MUTATING tool stays absent — see the class comment. */
  getToolDefinitions() {
    return (0, _tutorialHelp.getTutorialHelpToolDefinitions)(this.webSearchEnabled());
  }
  async executeTool(name, input, stop) {
    if (name === 'webSearch') {
      // The handler re-checks the toggle before any await, so a call replayed
      // from a conversation held while it was on still cannot search.
      return {
        result: await (0, _webSearchHandler.handleWebSearch)(input ?? {}, stop)
      };
    }

    // Reached only if a model invents a tool name it was never offered. Logged
    // rather than thrown: a fabricated call must degrade to an ordinary reply,
    // never take down a chat opened from a tutorial card.
    _logger.default.warn('[TutorialHelpAgent] Refused a tool call — this agent has no tools', {
      name
    });
    return {
      result: {
        error: 'this assistant only explains how mera works and cannot change anything'
      }
    };
  }
}
exports.TutorialHelpAgent = TutorialHelpAgent;