"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ArticleFeedbackAgent = void 0;
var _factService = require("../../database/services/fact-service");
var _articleSuggestionReads = require("../../database/services/article-suggestion-reads");
var _articleFeedbackService = require("../../database/services/article-feedback-service");
var _suppressionService = require("../../database/services/suppression-service");
var _articleService = require("../../article-service");
var _proposalHandlers = require("../../chat-tools/proposal-handlers");
var _articleSuggestionStatus = require("../../database/article-suggestion-status");
var _logger = _interopRequireDefault(require("../../logger"));
var _appLanguageStore = require("../../stores/app-language-store");
var _floatingChatStore = require("../../stores/floating-chat-store");
var _meraProtocolStore = require("../../stores/mera-protocol-store");
var _chatCloud = require("../chat-cloud");
var _supportedLanguages = require("../../supported-languages");
var _trackedStoryService = require("../../database/services/tracked-story-service");
var _trackActions = require("../../tracking/track-actions");
var _webSearchHandler = require("../../chat-tools/web-search-handler");
var _agentCore = require("../../news-harness/article-feedback/agent-core");
var _factCheck = require("../../news-harness/fact-check");
var _untrustedText = require("../../news-harness/prompts/untrusted-text");
var _proposals = require("../../news-harness/core/proposals");
var _i18n = _interopRequireDefault(require("../../platform/i18n"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// ArticleFeedbackAgent — implements IAgent for the article-suggestion feedback
// chat surface. Explains WHY an article was suggested and handles "more/less of
// this" feedback by STAGING persona changes as a proposal the user confirms.
//
// It never mutates the persona directly: proposeChanges stages a StagedProposal
// (returned via sideEffects.proposal), and applyProposal / cancelProposal
// resolve the single in-flight proposal held on the floating-chat store. This
// keeps the confirm flow working on the one-shot local path (no re-inference) —
// the PENDING PROPOSAL block is re-injected into <context> every turn.
//
// This is the thin RN adapter: it reads facts / suggestion context / stores and
// delegates all prompt, context, tool-definition, and propose-decision
// construction to the RN-free brain in
// lib/news-harness/article-feedback/agent-core.ts.

/**
 * Sanitises and brands one nullable publisher-derived field, keeping null and
 * undefined as they were so an absent field stays absent rather than becoming
 * an empty string the prompt would render as a blank line.
 *
 * The cap is the value's OWN length, which makes it a no-op cap by construction.
 * That is load-bearing rather than lazy. `asUntrusted`'s `maxLength` applies to
 * the RAW input, and every downstream render site in agent-core applies its own
 * cap already - 160 for a title, 80 for a publication, 60 for a category or an
 * entity, 200 for a reason, and 900 for a description on the claim-picker path,
 * which is wider than `asUntrusted`'s 500-character default. Branding with that
 * default here would silently narrow the claim-picker description from 900 to
 * 500 and quietly move the separability measurement it was calibrated against.
 * A named constant would have to track the widest of those caps forever; the
 * value's own length cannot drift.
 */
function brandNullable(value) {
  if (value == null) return value;
  return (0, _untrustedText.asUntrusted)(value, value.length);
}
class ArticleFeedbackAgent {
  constructor(userId, target,
  /** Origin snapshot for the "follow this story" (proposeTrack) tool. Present
   *  only when the chat was opened from a Track tap; absent for a plain
   *  thumbs-down feedback chat (then the tool falls back to a minimal subject
   *  built from the target + article title, or refuses if it can't). */
  trackSubject) {
    this.userId = userId;
    this.target = target;
    this.trackSubject = trackSubject;
    this.id = void 0;
    /** Thinking OFF. Measured 2026-10-22 (run-singleshot-corpus, article
     *  fixtures): off kept the pass rate on both Qwen3.8 and Qwen3.6, and article
     *  turns fell from p50 ~15s to ~2s. Also the cloudChatStream default now. */
    this.chatThinking = false;
    /** Related-coverage fetch, memoized for the agent instance (buildContext runs
     *  every turn). Only fetched when a track subject was passed explicitly (the
     *  follow-a-story flow) so plain thumbs-down chats make no extra network call.
     *  Failure → []. */
    this.relatedCoveragePromise = null;
    // --- IAgent: system prompt (static — cacheable by KV cache) ---
    this.cachedSystemPrompt = null;
    this.lastNeedsToolFormat = null;
    this.lastLanguageName = null;
    this.lastMode = null;
    this.lastWebSearch = null;
    this.id = `article-feedback-${target.suggestionId ?? target.articleId}`;
  }
  getRelatedCoverage() {
    if (this.relatedCoveragePromise) return this.relatedCoveragePromise;
    // Gate on the EXPLICIT trackSubject (not resolveTrackSubject's minimal
    // fallback) — sibling titles only ground the multi-option track proposal.
    const articleId = this.trackSubject?.articleId;
    if (!articleId) {
      this.relatedCoveragePromise = Promise.resolve([]);
      return this.relatedCoveragePromise;
    }
    const ownTitle = this.trackSubject?.title;
    this.relatedCoveragePromise = (async () => {
      try {
        const cluster = await _articleService.ArticleService.getNewsClusterForArticle(articleId);
        const rows = cluster?.articles?.articles ?? [];
        const titles = [];
        for (const a of rows) {
          const title = a?.title_en_internal_only ?? a?.title ?? null;
          if (typeof title !== 'string') continue;
          const trimmed = title.trim();
          if (!trimmed || trimmed === ownTitle) continue;
          titles.push(trimmed);
          if (titles.length >= 5) break;
        }
        return titles;
      } catch {
        return [];
      }
    })();
    return this.relatedCoveragePromise;
  }

  /** The user's ACTIVE "not interested" filters, as the RN-free plain view the
   *  harness renders into <context> and validates `retire_suppression` against.
   *  Read fresh on every turn AND on every proposeChanges (the user may have
   *  just added one). Best-effort: a failure means no filters block and a
   *  rejected retire_suppression, never a broken chat. */
  async loadActiveSuppressions() {
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

  /** The joined suggestion row mapped into the harness's enum-free plain shape.
   *  Shared by buildContext (renders it) and proposeChanges (corroborates a
   *  structured suppression value against it).
   *
   *  This method IS the publisher boundary for the feedback agent: every
   *  publisher-derived field on `SuggestionFeedbackContext` is typed
   *  `UntrustedText`, so the compiler refuses a raw row value here rather than
   *  leaving the boundary to be checked by reading. `matchedTopicTexts` and
   *  `linkedFacts` pass through raw ON PURPOSE - they are the user's own topics
   *  and persona facts, not publisher text, and branding them would assert
   *  something false about where they came from. */
  async loadArticleContext() {
    const ctx = await (0, _articleSuggestionReads.getSuggestionFeedbackContext)(this.target);
    if (!ctx) return null;
    return {
      suggestion: {
        title_en: brandNullable(ctx.suggestion.title_en),
        title_original: brandNullable(ctx.suggestion.title_original),
        publication_name: brandNullable(ctx.suggestion.publication_name),
        description_en: brandNullable(ctx.suggestion.description_en),
        isScored: ctx.suggestion.status === _articleSuggestionStatus.ArticleSuggestionStatus.Complete,
        relevance: ctx.suggestion.relevance,
        reason: brandNullable(ctx.suggestion.reason)
      },
      matchedTopicTexts: ctx.matchedTopicTexts,
      linkedFacts: ctx.linkedFacts,
      entities: ctx.entities?.map(entity => (0, _untrustedText.asUntrusted)(entity, entity.length)),
      category: brandNullable(ctx.category)
    };
  }

  /**
   * The article snapshot `proposeFactCheck` stages against.
   *
   * Read from the SUGGESTION ROW rather than from the chat context, because the
   * chat may have been opened with a suggestionId alone and both halves of the
   * card need a real `articleId`: the quick path has nothing to do without one,
   * and the async path's whole payload IS the article id. A null return refuses
   * the tool rather than staging pills against an empty id.
   */
  async resolveFactCheckSubject() {
    const ctx = await (0, _articleSuggestionReads.getSuggestionFeedbackContext)(this.target).catch(() => null);
    const storeContext = _floatingChatStore.useFloatingChatStore.getState().context;
    const storeTitle = storeContext.kind === 'article-suggestion' ? storeContext.articleTitle : undefined;
    const articleId = ctx?.suggestion.articleId ?? this.target.articleId ?? '';
    if (!articleId) return null;
    const title = ctx?.suggestion.title_en ?? ctx?.suggestion.title_original ?? storeTitle ?? '';
    return (0, _factCheck.makeFactCheckSubject)({
      articleId,
      title,
      description: ctx?.suggestion.description_en ?? null,
      url: ctx?.suggestion.article_url ?? null,
      publicationName: ctx?.suggestion.publication_name ?? null
    });
  }

  /** Resolve the subject the follow tool tracks against: the explicit
   *  trackSubject, else a minimal one built from the target + store title. */
  resolveTrackSubject() {
    if (this.trackSubject) return this.trackSubject;
    const articleId = this.target.articleId;
    if (!articleId) return null;
    const storeContext = _floatingChatStore.useFloatingChatStore.getState().context;
    const title = storeContext.kind === 'article-suggestion' ? storeContext.articleTitle : undefined;
    return {
      origin: 'suggestion',
      surface: 'detail',
      articleId,
      title: title ?? ''
    };
  }
  async buildSystemPrompt(needsToolFormat) {
    const appLanguage = _appLanguageStore.useAppLanguageStore.getState().appLanguage;
    const languageName = _supportedLanguages.SUPPORTED_LANGUAGES.find(l => l.code === appLanguage)?.name ?? 'English';
    // Read ONCE, non-reactively, at turn-build time (same seam as
    // PersonaUpdateAgent.buildSystemPrompt) so the prompt and the tool payload
    // this turn agree with each other.
    const protocol = _meraProtocolStore.useMeraProtocolStore.getState();
    const mode = (0, _chatCloud.chatRunsInCloud)() ? 'CLOUD' : 'LOCAL';
    // Gates the SAME prose getToolDefinitions gates the tool declaration with —
    // see agent-core's buildArticleFeedbackSystemPrompt. Must be part of the
    // cache key: without it, a prompt built while the toggle was off (or CLOUD
    // flipped to LOCAL) would keep serving stale text after the user flips the
    // toggle on, so getToolDefinitions() would declare `webSearch` while the
    // cached prompt still tells the model it has no way to look beyond the
    // metadata — reproducing the exact "toggle on, still refuses" bug reported.
    const webSearch = mode === 'CLOUD' && protocol.webSearchInChat === true;

    // Static content depends only on needsToolFormat + languageName + mode +
    // webSearch — all fixed per session unless the user changes app language,
    // processing mode, or the web-search toggle.
    if (this.cachedSystemPrompt && this.lastNeedsToolFormat === needsToolFormat && this.lastLanguageName === languageName && this.lastMode === mode && this.lastWebSearch === webSearch) {
      return this.cachedSystemPrompt;
    }
    this.cachedSystemPrompt = (0, _agentCore.buildArticleFeedbackSystemPrompt)({
      needsToolFormat,
      languageName,
      webSearch,
      // Same gate as getToolDefinitions' `proposeFactCheck` declaration, and
      // part of the cache key below for the same reason webSearch is: a prompt
      // built in one mode must not keep serving after the user switches.
      factCheck: mode === 'CLOUD',
      factPlaces: mode === 'CLOUD'
    });
    this.lastNeedsToolFormat = needsToolFormat;
    this.lastLanguageName = languageName;
    this.lastMode = mode;
    this.lastWebSearch = webSearch;
    return this.cachedSystemPrompt;
  }

  // --- IAgent: dynamic context (rebuilt every turn) ---

  async buildContext() {
    const context = await this.loadArticleContext();
    // Same CLOUD gate as the prompt section and the tool declaration — a fourth
    // place it must agree, because it decides how much of the article the claim
    // picker actually gets to read.
    const factCheck = (0, _chatCloud.chatRunsInCloud)();
    const facts = await (0, _factService.getFacts)(); // newest-first (sorted created_at desc)

    const storeContext = _floatingChatStore.useFloatingChatStore.getState().context;
    const fallbackTitle = storeContext.kind === 'article-suggestion' ? storeContext.articleTitle : undefined;
    // Feed-verdict handoff: the like/dislike + tapped-option label breadcrumb.
    const verdict = storeContext.kind === 'article-suggestion' ? storeContext.verdict : undefined;
    const tappedOptions = storeContext.kind === 'article-suggestion' ? storeContext.treePath : undefined;
    const proposal = _floatingChatStore.useFloatingChatStore.getState().proposal;

    // Follow-state so the agent can decline a duplicate track (best-effort).
    let isTracked;
    const trackSubject = this.resolveTrackSubject();
    if (trackSubject) {
      try {
        isTracked = await (0, _trackActions.isSubjectTracked)(trackSubject);
      } catch {
        /* non-fatal — leave undefined (no TRACK STATE line) */
      }
    }

    // Sibling titles (only when following a story) ground multi-option tracks.
    const relatedCoverage = await this.getRelatedCoverage();
    // Active filters so the agent can offer to REMOVE one.
    const activeSuppressions = await this.loadActiveSuppressions();
    // Read every turn so a mistake marked mid-chat shows; the reader never throws.
    const mistakes = await (0, _articleFeedbackService.getRecentSystemMistakes)(5);
    return (0, _agentCore.buildFeedbackContext)({
      // The real clock lives HERE (the adapter), never inside the pure builder —
      // anchors proposeTrack scopes to the present instead of to whatever year
      // dominates the model's training data.
      nowMs: Date.now(),
      articlePubDate: trackSubject?.pubDate ?? null,
      facts,
      context,
      fallbackTitle,
      proposal,
      isTracked,
      relatedCoverage,
      verdict,
      tappedOptions,
      feedbackAnswers: storeContext.kind === 'article-suggestion' ? storeContext.feedbackAnswers : undefined,
      activeSuppressions,
      mistakes,
      factCheck
    });
  }

  // --- IAgent: tool definitions (OpenAI JSON Schema for cloud chat) ---

  getToolDefinitions() {
    // Read fresh (not the buildSystemPrompt cache) — this method is also called
    // standalone (tool-name resolution) on a turn whose prompt was never rebuilt. Same gate as the
    // prompt's webSearchLine: CLOUD mode AND the user's toggle. The handler
    // (web-search-handler.ts) re-checks the toggle regardless — belt-and-braces
    // for a persisted conversation replaying a call made while it was on.
    const protocol = _meraProtocolStore.useMeraProtocolStore.getState();
    const mode = (0, _chatCloud.chatRunsInCloud)() ? 'CLOUD' : 'LOCAL';
    return (0, _agentCore.getArticleFeedbackToolDefinitions)(mode, protocol.webSearchInChat === true);
  }

  // --- IAgent: tool execution ---

  async executeTool(name, input, stop) {
    const args = input ?? {};
    switch (name) {
      case 'proposeChanges':
        {
          // Validate referenced fact ids in a single getFacts pass, then let the
          // pure brain decide the staged proposal / error. The article context +
          // active filters let it corroborate a structured suppression value
          // and resolve a retire_suppression id against real rows.
          const facts = await (0, _factService.getFacts)();
          const factIds = new Set(facts.map(f => f.id));
          const article = await this.loadArticleContext();
          const activeSuppressions = await this.loadActiveSuppressions();
          return (0, _agentCore.decideProposeChanges)(args, factIds, {
            article,
            activeSuppressions
          });
        }
      case 'proposeTrack':
        {
          // "Follow this story" — stage a track_story proposal. Guard against a
          // duplicate follow up front (deterministic, not left to the LLM).
          const subject = this.resolveTrackSubject();
          if (!subject) {
            return {
              result: {
                error: 'no article to follow in this context'
              }
            };
          }
          try {
            // Stage when at least one proposed option is not yet followed for this
            // article: two scopes of one story are two follows.
            const options = (0, _agentCore.parseTrackScopeOptions)(Array.isArray(args.options) ? args.options : []);
            const followed = await Promise.all(options.map(o => (0, _trackedStoryService.isTracked)({
              stableClusterId: subject.stableClusterId ?? null,
              articleId: subject.articleId,
              searchText: o.search
            })));
            const allFollowed = options.length > 0 ? followed.every(Boolean) : await (0, _trackActions.isSubjectTracked)(subject);
            if (allFollowed) {
              return {
                result: {
                  alreadyTracked: true,
                  message: 'Already following this story.'
                }
              };
            }
          } catch {
            /* non-fatal — proceed to propose */
          }
          return (0, _agentCore.decideProposeTrack)(args, subject);
        }
      case 'proposeFactCheck':
        {
          // Stage the claim pills against this article's snapshot, plus the
          // always-last whole-article option. No already-checked guard: per-claim
          // identity means one article can legitimately carry several checks.
          //
          // The article option's label is USER-FACING PROSE, not a search key, so
          // it is localized HERE — the pure layer never reads i18n — and it is
          // resolved at stage time so the persisted tool result carries the same
          // string the resumed card rebuilds from.
          const subject = await this.resolveFactCheckSubject();
          if (!subject) {
            return {
              result: {
                error: 'no article to fact-check in this context'
              }
            };
          }
          // `factCheck.optionWholeArticle` lands with the next `en.json` update;
          // typed `t` is generated from that file, so the key is not in the union
          // yet. One cast, and deliberately no `defaultValue` — an inline English
          // default is how English has previously shipped into 19 locale files.
          return (0, _factCheck.decideProposeFactCheck)(args, subject, _i18n.default.t('factCheck.optionWholeArticle'));
        }
      case 'applyProposal':
        {
          const proposal = _floatingChatStore.useFloatingChatStore.getState().proposal;
          if (!proposal) return {
            result: {
              error: 'no pending proposal'
            }
          };

          // SINGLE-SELECT cards are never applied from chat. The alternatives are
          // mutually exclusive and only ProposalCard.handleConfirm knows WHICH one
          // the user picked, so applying them all is not "what the user asked for":
          // a typed "yes" against a 3-pill proposeTrack card minted three topics
          // AND three followed stories. A model-chosen index would not fix it —
          // the model's reading of assent is exactly what is not trusted here
          // (same conclusion as run_calibration, and as FollowStoryAgent, which
          // refuses applyProposal outright). Consent is the tap.
          //
          // No `proposalResolved` side effect: the card must stay pending so the
          // pills remain tappable, and the message gives the model something true
          // to say instead of stranding the user in silence.
          if ((0, _proposals.proposalRequiresUserChoice)(proposal)) {
            return {
              result: (0, _proposals.chooseOneRefusal)(proposal)
            };
          }

          // UI-ONLY actions are stripped before the executor sees them (which
          // would silently drop them anyway, since they are user-confirmed-only).
          // Doing it here is what keeps the CARD alive: applying a
          // run_calibration-only proposal used to report applied:0 and still
          // resolve the card, putting the recalibration out of reach. Mirrors
          // PersonaUpdateAgent.applyProposal.
          const uiOnly = proposal.actions.filter(a => a.type === 'run_calibration');
          const applicable = proposal.actions.filter(a => a.type !== 'run_calibration');
          if (applicable.length === 0) return {
            result: (0, _proposals.userTapOnlyRefusal)()
          };
          const {
            applied,
            errors,
            summaries,
            changeLogIds
          } = await (0, _proposalHandlers.executeProposalActions)(applicable);
          // A Feed-verdict handoff whose proposals just APPLIED has folded that
          // verdict into the persona — stamp its feedback row processed so the
          // deferred daily plan won't double-count it. Best-effort; gated on
          // the store context carrying a verdict + article id.
          const sc = _floatingChatStore.useFloatingChatStore.getState().context;
          if (sc && sc.kind === 'article-suggestion' && sc.verdict) {
            const articleId = sc.articleId ?? this.target.articleId;
            if (articleId) {
              await (0, _articleFeedbackService.markFeedbackProcessedFor)(articleId, sc.verdict).catch(() => {
                /* non-fatal */
              });
            }
          }
          // summaries + changeLogIds surface what changed and power undo (revert_change).
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
            // card would vanish before the user could confirm the rest.
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

      // OPT-IN, off by default — see getToolDefinitions and agent-core's
      // WEB_SEARCH_TOOL. Declared only while the toggle is on, but an
      // UNDECLARED replayed call (persisted conversation, toggle now off)
      // still lands here: normalizeToolName finds no declared match, the raw
      // name falls through, and handleWebSearch re-checks the toggle as its
      // first statement before any await — same shape as PersonaUpdateAgent's
      // 'webSearch' case.
      case 'webSearch':
        {
          const result = await (0, _webSearchHandler.handleWebSearch)(args, stop);
          return {
            result
          };
        }
      default:
        _logger.default.warn('[ArticleFeedbackAgent] Unknown tool', {
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
exports.ArticleFeedbackAgent = ArticleFeedbackAgent;