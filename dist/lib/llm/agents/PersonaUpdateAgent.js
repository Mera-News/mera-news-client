"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PersonaUpdateAgent = void 0;
var _toolHandlers = require("../../chat-tools/tool-handlers");
var _newsSearchHandler = require("../../chat-tools/news-search-handler");
var _webSearchHandler = require("../../chat-tools/web-search-handler");
var _factService = require("../../database/services/fact-service");
var _suppressionService = require("../../database/services/suppression-service");
var _proposalHandlers = require("../../chat-tools/proposal-handlers");
var _floatingChatStore = require("../../stores/floating-chat-store");
var _logger = _interopRequireDefault(require("../../logger"));
var _prompts = require("../../news-harness/prompts/prompts");
var _appLanguageStore = require("../../stores/app-language-store");
var _meraProtocolStore = require("../../stores/mera-protocol-store");
var _chatCloud = require("../chat-cloud");
var _graphqlTypes = require("../../generated/graphql-types");
var _supportedLanguages = require("../../supported-languages");
var _personaAgentCore = require("../../news-harness/persona-management/persona-agent-core");
var _estimateTokens = require("../../algorithms/estimate-tokens");
var _toolNames = require("../../news-harness/persona-management/tool-names");
var _proposals = require("../../news-harness/core/proposals");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// PersonaUpdateAgent — implements IAgent for the persona update chat surface.
// Responsible for system prompt construction, message formatting, and tool execution.
// Conversations are ephemeral (in-memory only, managed by useMeraLLM).

class PersonaUpdateAgent {
  constructor(userId, surface) {
    this.userId = userId;
    this.surface = surface;
    this.id = void 0;
    // --- IAgent: system prompt (static — cacheable by KV cache) ---
    this.cachedSystemPrompt = null;
    this.lastNeedsToolFormat = null;
    this.lastLanguageName = null;
    this.lastMode = null;
    this.lastFilterTools = null;
    /** Both toggles change the STATIC prompt, so both belong in its cache key —
     *  without them, flipping a toggle mid-session would keep serving the prompt
     *  built before the flip. */
    this.lastWebSearch = null;
    this.lastCanCalibrate = null;
    /**
     * This turn's FILTERS budget decision. Recomputed by
     * MEASUREMENT in buildSystemPrompt — which both chat hooks call immediately
     * before buildContext (useLocalLLM.ts:267/278, useCloudPersonaChat.ts:372/382)
     * — and read back in buildContext. Defaults to the full feature so an agent
     * whose buildSystemPrompt was never called still behaves.
     */
    this.turnPlan = {
      filterTools: 'full',
      includeFiltersBlock: true
    };
    this.id = `persona-${userId}-${surface}`;
  }
  async buildSystemPrompt(needsToolFormat) {
    const appLanguage = _appLanguageStore.useAppLanguageStore.getState().appLanguage;
    const languageName = _supportedLanguages.SUPPORTED_LANGUAGES.find(l => l.code === appLanguage)?.name ?? 'English';
    // Read ONCE, non-reactively, at turn-build time — so the whole turn
    // (prompt + tool payload) is built against one consistent snapshot of the
    // user's settings rather than re-reading a store that could change mid-turn.
    const protocol = _meraProtocolStore.useMeraProtocolStore.getState();
    const mode = (0, _chatCloud.chatRunsInCloud)() ? 'CLOUD' : 'LOCAL';
    // Prose about `webSearch` only makes sense where the tool is declared:
    // CLOUD, and only with the toggle on.
    const webSearch = mode === 'CLOUD' && protocol.webSearchInChat === true;
    // Recalibration is a cloud scoring call: On this phone (cloud chat or not) it is not offered.
    const canCalibrate = protocol.processingMode !== _graphqlTypes.ProcessingMode.OnDevice;

    // Pass our own (test-mockable) buildPersonaUpdateStaticPrompt import explicitly
    // so persona-agent-core calls THIS function reference rather than its own
    // default harness import — keeps the frozen unit-test mock seam intact.
    // Memoized per call so the variant we MEASURE is the string we return —
    // the common case builds exactly one prompt, as before.
    const built = new Map();
    const buildAt = filterTools => {
      const hit = built.get(filterTools);
      if (hit !== undefined) return hit;
      const prompt = (0, _personaAgentCore.buildPersonaSystemPrompt)({
        surface: this.surface,
        includeToolFormat: needsToolFormat,
        languageName,
        mode,
        // ONBOARDING carries no filter tools at all, so leave the earlier
        // call-args shape untouched there.
        ...(this.surface === 'CONFIG' ? {
          filterTools
        } : {}),
        // "Deeper questions" is always on (owner): there is no
        // switch, and whatever an older build stored is not read.
        deepMode: true,
        ...(webSearch ? {
          webSearch: true
        } : {}),
        ...(canCalibrate ? {} : {
          canCalibrate: false
        })
      }, _prompts.buildPersonaUpdateStaticPrompt);
      built.set(filterTools, prompt);
      return prompt;
    };
    this.turnPlan = await this.planTurn({
      buildAt
    });

    // Static prompt depends on surface + needsToolFormat + languageName + mode —
    // all fixed per session — PLUS this turn's filter variant, which is
    // data-dependent and so must be part of the cache key.
    if (this.cachedSystemPrompt && this.lastNeedsToolFormat === needsToolFormat && this.lastLanguageName === languageName && this.lastMode === mode && this.lastFilterTools === this.turnPlan.filterTools && this.lastWebSearch === webSearch && this.lastCanCalibrate === canCalibrate) {
      return this.cachedSystemPrompt;
    }
    this.cachedSystemPrompt = buildAt(this.turnPlan.filterTools);
    this.lastNeedsToolFormat = needsToolFormat;
    this.lastLanguageName = languageName;
    this.lastMode = mode;
    this.lastFilterTools = this.turnPlan.filterTools;
    this.lastWebSearch = webSearch;
    this.lastCanCalibrate = canCalibrate;
    return this.cachedSystemPrompt;
  }

  /**
   * Chooses how much of the FILTERS feature this turn can afford, by measuring
   * the real candidate prompts against this turn's real data — never by
   * comparing the facts to a hardcoded threshold.
   *
   * ONBOARDING short-circuits: it never carries the filter tools, so every
   * variant renders the same prompt and there is nothing to yield.
   *
   * ── planTurn does NOT measure conversation history, and must not start ──
   *
   * The tempting inference — "widening the chat history window will push turns
   * over this budget and evict the tools" — is FALSE, and was verified false
   * before the history window was widened. planPersonaPrompt's only inputs are
   * the system prompt, the known-facts block, and the filters block (see its
   * signature); wire history is not among them and never reaches it. Widening
   * history therefore cannot move `filterTools` toward `off` and cannot strip
   * tools from the cloud payload.
   *
   * Do not "fix" this by adding history tokens to baseContextTokens. It would
   * couple the two, and the visible effect would be the ladder dropping the
   * user's own FILTERS block partway through a long conversation — a product
   * change, not a safety guard. History is budgeted separately and yields
   * BEFORE this ladder does; see lib/news-harness/persona-management/history-window.ts.
   */
  async planTurn(params) {
    if (this.surface !== 'CONFIG') {
      return {
        filterTools: 'full',
        includeFiltersBlock: false
      };
    }
    const facts = await (0, _factService.getFacts)();
    const suppressions = await this.loadActiveSuppressions();
    const filtersBlock = (0, _personaAgentCore.formatActiveFiltersList)(suppressions);
    return (0, _personaAgentCore.planPersonaPrompt)({
      systemTokensFor: variant => (0, _estimateTokens.estimateTokens)(params.buildAt(variant)),
      baseContextTokens: (0, _estimateTokens.estimateTokens)((0, _personaAgentCore.formatKnownFactsList)(facts)),
      filtersBlockTokens: filtersBlock ? (0, _estimateTokens.estimateTokens)(filtersBlock) : 0
    });
  }

  // --- IAgent: dynamic context (injected into user messages each turn) ---

  /** The user's ACTIVE "not interested" filters as the harness's plain view.
   *  CONFIG only — onboarding has no feed yet, so it
   *  neither offers the filter tools nor pays the context tokens. Best-effort:
   *  a failure means no filters block and a rejected retire_suppression, never a
   *  broken chat. */
  async loadActiveSuppressions() {
    if (this.surface !== 'CONFIG') return [];
    try {
      const rows = await (0, _suppressionService.getActive)();
      return rows.map(s => ({
        id: s.id,
        pattern: s.pattern,
        kind: s.kind,
        value: s.value,
        strength: s.strength
      }));
    } catch {
      return [];
    }
  }

  /** The CORROBORATION set for a named-publication
   *  preference: every outlet name that provably exists in the USER'S OWN data
   *  (visit history ∪ the local suggestion cache), normalized exactly the way
   *  `pubPref` matching normalizes. A name the model invented is absent here and
   *  its proposal is dropped, so the Source-preferences screen can never show a
   *  row that looks live and does nothing.
   *
   *  Lazily `require`d, mirroring `persona-mutation-sweeps.runSweep`: a static
   *  import would drag two more WatermelonDB collection singletons into every
   *  consumer of this agent for a set that is only read on a `proposeChanges`
   *  turn. CONFIG only and best-effort, exactly like `loadActiveSuppressions` —
   *  a read failure yields an empty set, which drops every named proposal (the
   *  safe direction). Swallowed rather than logged for the same reason that one
   *  swallows: this is a prompt-input read, not a mutation. */
  async loadKnownPublicationNames() {
    const names = new Set();
    if (this.surface !== 'CONFIG') return names;
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const visits = require("../../database/services/publication-visit-service");
      const suggestions = require("../../database/services/article-suggestion-reads");
      /* eslint-enable @typescript-eslint/no-require-imports */
      const [visited, suggested] = await Promise.all([visits.getTopVisitedPublications(), suggestions.getDistinctSuggestionPublicationNames()]);
      for (const v of visited) {
        const norm = (0, _personaAgentCore.normalizePublicationNameForMatch)(v.publicationName ?? '');
        if (norm) names.add(norm);
      }
      // Already normalized by the service, but re-normalizing is idempotent and
      // keeps the two sources provably on one rule.
      for (const s of suggested) {
        const norm = (0, _personaAgentCore.normalizePublicationNameForMatch)(s);
        if (norm) names.add(norm);
      }
    } catch {
      // Empty set ⇒ every named proposal drops. Safe direction.
    }
    return names;
  }
  async buildContext() {
    const facts = await (0, _factService.getFacts)();
    const suppressions = await this.loadActiveSuppressions();
    // Re-injected every turn so the one-shot LOCAL path can resolve a confirm.
    const {
      proposal,
      topicPlanNotes
    } = _floatingChatStore.useFloatingChatStore.getState();
    return (0, _personaAgentCore.buildPersonaContext)({
      facts,
      suppressions,
      proposal,
      // What the user did with topic-plan cards. This is the ONLY channel that
      // reaches the model identically on both engines — buildContext runs
      // fresh every turn on cloud and on-device, and is never persisted or
      // shown to the user.
      topicPlanNotes,
      includeFiltersBlock: this.turnPlan.includeFiltersBlock
    }, {
      buildContext: _prompts.buildPersonaUpdateContext
    });
  }

  // --- IAgent: tool definitions (OpenAI JSON Schema for cloud chat) ---

  getToolDefinitions() {
    // The turn's plan also decides whether the cloud tool payload carries them.
    //
    // `mode` gates the CLOUD-only knowledge tool (explainMera). Derived exactly
    // as buildSystemPrompt derives it, from the same store — not cached from the
    // last buildSystemPrompt call, because this method is also called
    // standalone (executeTool's name normalisation) on an agent whose prompt was never built this turn.
    //
    // `webSearchInChat` gates the web-search DECLARATION, and it is read from
    // the same non-reactive snapshot for the same reason: this method is also
    // called standalone. Gating the DECLARATION (not just the handler) is the
    // point — a handler-only check would leave an off-by-default tool in the
    // payload on every turn, paying tokens for a feature the user declined.
    // The handler re-checks the toggle regardless; see chat-tools/web-search-handler.
    const protocol = _meraProtocolStore.useMeraProtocolStore.getState();
    const mode = (0, _chatCloud.chatRunsInCloud)() ? 'CLOUD' : 'LOCAL';
    return (0, _personaAgentCore.getPersonaToolDefinitions)(this.surface, _prompts.buildToolDefinitions, this.turnPlan.filterTools, mode, protocol.webSearchInChat === true, protocol.processingMode !== _graphqlTypes.ProcessingMode.OnDevice);
  }

  // --- IAgent: tool execution ---

  async executeTool(name, input) {
    const args = input ?? {};

    // Normalize LLM misspellings against the REAL tool list rather than a
    // single hardcoded typo — casing, separators, and small edit distances all
    // resolve; genuine unknowns still fall to `default:` below.
    const normalizedName = (0, _toolNames.normalizeToolName)(name, this.getToolDefinitions().map(d => d.function.name)) ?? name;
    switch (normalizedName) {
      case 'saveExtractedFacts':
        {
          const result = await (0, _toolHandlers.handleSaveExtractedFacts)(args);
          return {
            result
          };
        }
      case 'updateUserConfig':
        {
          const result = await (0, _toolHandlers.handleUpdateUserConfig)(args);
          return {
            result
          };
        }
      case 'deleteUserFacts':
        {
          const result = await (0, _toolHandlers.handleDeleteUserFacts)(args);
          return {
            result
          };
        }

      // KNOWLEDGE tool (CLOUD only). Pure read of a frozen reference document —
      // no database, no network, no sideEffects.
      case 'explainMera':
        {
          const result = await (0, _toolHandlers.handleExplainMera)(args);
          return {
            result
          };
        }

      // SEARCH tools (CLOUD only), both READS whose result is the point — see
      // KNOWLEDGE_TOOL_NAMES, which both belong to so the continuation pass
      // actually posts the results back for the model to read.
      //
      // `searchNews` hits Mera's own index: guarded, metered-exempt,
      // headline-only. Nothing but the search words leaves the device.
      case 'searchNews':
        {
          const result = await (0, _newsSearchHandler.handleSearchNews)(args);
          return {
            result
          };
        }

      // `webSearch` is OPT-IN and off by default. Its declaration is omitted
      // while the toggle is off — but a persisted conversation can replay a
      // call made while it was on, and such a call lands HERE (undeclared ⇒
      // normalizeToolName can't match it ⇒ the raw name falls through to this
      // case). handleWebSearch re-reads the toggle as its first statement,
      // before any await, so an off toggle makes zero network calls.
      case 'webSearch':
        {
          const result = await (0, _webSearchHandler.handleWebSearch)(args);
          return {
            result
          };
        }
      case 'issueWarning':
        {
          const result = await (0, _toolHandlers.handleIssueWarning)(args);
          return {
            result,
            sideEffects: result.blocked === true ? {
              blocked: {
                reason: result.blockedReason
              }
            } : undefined
          };
        }

      // --- "Not interested": the SAME staged-proposal path the
      // ArticleFeedbackAgent has, so "Mera, stop showing me celebrity gossip"
      // works in plain chat. Nothing is written until the user confirms.
      case 'proposeChanges':
        {
          const [activeSuppressions, knownPublicationNames] = await Promise.all([this.loadActiveSuppressions(), this.loadKnownPublicationNames()]);
          return (0, _personaAgentCore.decidePersonaProposeChanges)(args, activeSuppressions, knownPublicationNames);
        }
      case 'applyProposal':
        {
          const proposal = _floatingChatStore.useFloatingChatStore.getState().proposal;
          if (!proposal) return {
            result: {
              error: 'no pending proposal'
            }
          };

          // SINGLE-SELECT cards are never applied from chat — only the tap knows
          // which alternative the user meant, so applying all of them is not
          // consent (see lib/news-harness/core/proposals.ts). This agent's own
          // proposeChanges cannot set `choose_one` today, but the floating-chat
          // store holds ONE global proposal shared with the article / follow-story
          // surfaces, so the guard is here rather than assumed unreachable — the
          // sibling call site had exactly this defect.
          if ((0, _proposals.proposalRequiresUserChoice)(proposal)) {
            return {
              result: (0, _proposals.chooseOneRefusal)()
            };
          }

          // UI-ONLY actions are stripped here. This is the second half of the
          // consent guarantee: staging alone would be pointless if the model
          // could then apply its own proposal by deciding the user said yes —
          // which is exactly the judgement it was measured getting wrong. Only
          // ProposalCard's Confirm button reaches these.
          const uiOnly = proposal.actions.filter(a => a.type === 'run_calibration');
          const applicable = proposal.actions.filter(a => a.type !== 'run_calibration');
          if (applicable.length === 0) return {
            result: (0, _proposals.userTapOnlyRefusal)()
          };

          // Same executor as the article surface — one seam, one audit trail.
          const {
            applied,
            errors,
            summaries,
            changeLogIds
          } = await (0, _proposalHandlers.executeProposalActions)(applicable);
          return {
            result: {
              applied,
              errors,
              summaries,
              changeLogIds,
              ...(uiOnly.length > 0 ? {
                awaitingUserConfirmation: true
              } : {})
            },
            // Only resolve when nothing is still waiting on a tap — otherwise the
            // card would vanish before the user could confirm it.
            ...(uiOnly.length === 0 ? {
              sideEffects: {
                proposalResolved: 'applied'
              }
            } : {})
          };
        }
      case 'cancelProposal':
        return {
          result: {
            cancelled: true
          },
          sideEffects: {
            proposalResolved: 'cancelled'
          }
        };
      case 'runCalibration':
        {
          // STAGES a confirmation card. Does NOT recalibrate.
          //
          // This tool used to run the recalibration outright, which made the
          // model's reading of a message the consent gate. Measured against the
          // real gateway on 2026-08-03: once the invitation was in history, a bare
          // "thanks!" produced the call 20/20 times, and adding an explicit
          // "confirmation only" block to <context> did not change that (also
          // 20/20) — while an explicit refusal WAS respected. The model reads a
          // polite acknowledgement as assent, and no wording fixed it.
          //
          // So consent moved out of the prompt and into the UI: this stages a
          // `run_calibration` proposal, ProposalCard renders it, and the action
          // executes only when the user taps Confirm. The model can still be
          // wrong about WHEN to offer — it can no longer be wrong about whether
          // the user agreed.
          const proposal = {
            id: `proposal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            explanation: 'Re-tune how Mera scores relevance, using your recent corrections.',
            expectedEffects: 'Scoring constants shift by at most ±20%. Reversible from your change history.',
            actions: [{
              type: 'run_calibration'
            }]
          };
          return {
            result: {
              staged: true,
              proposalId: proposal.id
            },
            sideEffects: {
              proposal
            }
          };
        }
      default:
        _logger.default.warn('[PersonaUpdateAgent] Unknown tool', {
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
exports.PersonaUpdateAgent = PersonaUpdateAgent;