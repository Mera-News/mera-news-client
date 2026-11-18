"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FollowStoryAgent = void 0;
var _chatCloud = require("../chat-cloud");
var _newsSearchHandler = require("../../chat-tools/news-search-handler");
var _webSearchHandler = require("../../chat-tools/web-search-handler");
var _proposalHandlers = require("../../chat-tools/proposal-handlers");
var _proposals = require("../../news-harness/core/proposals");
var _agentCore = require("../../news-harness/article-feedback/agent-core");
var _followStory = require("../../news-harness/follow-story");
var _logger = _interopRequireDefault(require("../../logger"));
var _appLanguageStore = require("../../stores/app-language-store");
var _floatingChatStore = require("../../stores/floating-chat-store");
var _meraProtocolStore = require("../../stores/mera-protocol-store");
var _supportedLanguages = require("../../supported-languages");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// FollowStoryAgent — implements IAgent for the "follow a story" chat opened from
// the Followed-stories screen's track FAB.
//
// It is the ARTICLE-LESS sibling of ArticleFeedbackAgent: same propose-then-
// confirm machinery (proposeTrack → StagedProposal of `track_story` actions →
// ProposalCard scope pills → executeProposalActions → trackStoryWithProposal),
// but scoped from FREE TEXT instead of from an article. It reuses
// `decideProposeTrack` verbatim, so the staged proposal is byte-identical in
// shape to the one the article surface stages and every downstream consumer
// (ProposalCard, deriveThreadItems, the executor) needs no change.
//
// This is the thin RN adapter: prompt/context/tool construction all live in the
// RN-free brain at lib/news-harness/follow-story.

class FollowStoryAgent {
  constructor(userId) {
    this.userId = userId;
    this.id = void 0;
    /** Thinking OFF. Measured 2026-10-14 (run-singleshot-corpus, BIG_MODEL):
     *  proposeTrack passed the pre-registered bar (10/12 vs 11/12, noise 1) and
     *  turn time fell from p50 7.3s / p90 13.9s to 3.3s / 4.3s. */
    this.chatThinking = false;
    // --- IAgent: system prompt (static — cacheable by KV cache) ---
    this.cachedSystemPrompt = null;
    this.lastNeedsToolFormat = null;
    this.lastLanguageName = null;
    this.lastCanSearch = null;
    this.lastWebSearch = null;
    this.id = `follow-story-${userId}`;
  }
  /**
   * The retrieval gates, read from the store and shared by `buildSystemPrompt`
   * and `getToolDefinitions` so the prompt and the tool payload for one turn
   * always agree.
   */
  searchGates() {
    const protocol = _meraProtocolStore.useMeraProtocolStore.getState();
    const mode = (0, _chatCloud.chatRunsInCloud)() ? 'CLOUD' : 'LOCAL';
    return {
      mode,
      canSearch: mode === 'CLOUD',
      webSearch: mode === 'CLOUD' && protocol.webSearchInChat === true
    };
  }
  async buildSystemPrompt(needsToolFormat) {
    const appLanguage = _appLanguageStore.useAppLanguageStore.getState().appLanguage;
    const languageName = _supportedLanguages.SUPPORTED_LANGUAGES.find(l => l.code === appLanguage)?.name ?? 'English';
    const {
      canSearch,
      webSearch
    } = this.searchGates();

    // canSearch and webSearch ARE PART OF THE CACHE KEY. Without them a prompt
    // built while the toggle was off keeps telling the model it cannot look
    // anything up after the user turns it on, while getToolDefinitions() hands
    // over the tool — the "toggle on, still refuses" bug ArticleFeedbackAgent
    // already had reported against it.
    if (this.cachedSystemPrompt && this.lastNeedsToolFormat === needsToolFormat && this.lastLanguageName === languageName && this.lastCanSearch === canSearch && this.lastWebSearch === webSearch) {
      return this.cachedSystemPrompt;
    }
    this.cachedSystemPrompt = (0, _followStory.buildFollowStorySystemPrompt)({
      needsToolFormat,
      languageName,
      canSearch,
      webSearch
    });
    this.lastNeedsToolFormat = needsToolFormat;
    this.lastLanguageName = languageName;
    this.lastCanSearch = canSearch;
    this.lastWebSearch = webSearch;
    return this.cachedSystemPrompt;
  }

  // --- IAgent: dynamic context (rebuilt every turn) ---

  async buildContext() {
    return (0, _followStory.buildFollowStoryContext)({
      // The real clock lives HERE (the adapter), never inside the pure builder —
      // it anchors scopes to the present instead of to whatever year dominates
      // the model's training data.
      nowMs: Date.now(),
      proposal: _floatingChatStore.useFloatingChatStore.getState().proposal
    });
  }

  // --- IAgent: tool definitions ---

  getToolDefinitions() {
    const {
      mode,
      webSearch
    } = this.searchGates();
    return (0, _followStory.getFollowStoryToolDefinitions)(mode, webSearch);
  }

  // --- IAgent: tool execution ---

  async executeTool(name, input) {
    const args = input ?? {};
    switch (name) {
      case 'proposeTrack':
        // Stage the scope pills against the article-less origin snapshot. No
        // already-following guard: a free-text follow has no article identity to
        // collide on, so there is nothing deterministic to check (see
        // makeFollowStorySubject).
        return (0, _agentCore.decideProposeTrack)(args, (0, _followStory.makeFollowStorySubject)());
      case 'cancelProposal':
        return {
          result: {
            cancelled: true
          },
          sideEffects: {
            proposalResolved: 'cancelled'
          }
        };

      // The two grounding tools. Without them this agent had no article, no
      // index and a rule against inventing entities, so a user naming a story
      // from this week left it nothing to do but ask again or refuse.
      case 'searchNews':
        return {
          result: await (0, _newsSearchHandler.handleSearchNews)(args)
        };
      case 'webSearch':
        return {
          result: await (0, _webSearchHandler.handleWebSearch)(args)
        };
      case 'applyProposal':
        {
          // A typed "yes" applies only a card holding ONE option (a plain confirm).
          // Two or more are the user's ticks and the Follow tap, so they are refused.
          const proposal = _floatingChatStore.useFloatingChatStore.getState().proposal;
          if (!proposal) return {
            result: {
              error: 'no pending proposal'
            }
          };
          if ((0, _proposals.proposalRequiresUserChoice)(proposal)) return {
            result: (0, _proposals.chooseOneRefusal)(proposal)
          };
          const {
            applied,
            errors,
            summaries,
            changeLogIds
          } = await (0, _proposalHandlers.executeProposalActions)(proposal.actions);
          return {
            result: {
              applied,
              errors,
              summaries,
              changeLogIds
            },
            // Already followed counts as applied; a failure keeps the card for a retry.
            ...(errors.length === 0 ? {
              sideEffects: {
                proposalResolved: 'applied'
              }
            } : {})
          };
        }
      default:
        _logger.default.warn('[FollowStoryAgent] Unknown tool', {
          name
        });
        return {
          result: {
            error: `Unknown tool: ${name}`
          }
        };
    }
  }
}
exports.FollowStoryAgent = FollowStoryAgent;