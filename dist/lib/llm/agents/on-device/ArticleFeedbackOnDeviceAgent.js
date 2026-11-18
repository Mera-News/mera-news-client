"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ArticleFeedbackOnDeviceAgent = void 0;
var _articleFeedback = require("../../../news-harness/on-device/article-feedback");
var _kevSpec = require("../../../news-harness/on-device/article-feedback/kev-spec");
var _shared = require("../../../news-harness/on-device/shared");
var _proposals = require("../../../news-harness/core/proposals");
var _articleSuggestionReads = require("../../../database/services/article-suggestion-reads");
var _articleFeedbackService = require("../../../database/services/article-feedback-service");
var _articleSuggestionStatus = require("../../../database/article-suggestion-status");
var _articleService = require("../../../article-service");
var _floatingChatStore = require("../../../stores/floating-chat-store");
var _trackActions = require("../../../tracking/track-actions");
var _ArticleFeedbackAgent = require("../ArticleFeedbackAgent");
var _run = require("./run");
// On-device article chat: one intent per turn, run through the cloud agent's
// own executors (already-following guard, choose-one refusal and all). The
// context reads are copies of the cloud agent's private ones, so the cloud
// class stays untouched. Route 'kev': Kev decides, the built-in model
// writes; 'single' is one built-in call.

const part = v => v ? `, ${v}` : '';
function day(raw) {
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? (0, _run.today)(ms) : null;
}
class ArticleFeedbackOnDeviceAgent {
  constructor(userId, target, trackSubject, opts = {}) {
    this.target = target;
    this.trackSubject = trackSubject;
    this.opts = opts;
    this.onDevice = true;
    this.id = void 0;
    this.cloud = void 0;
    this.relatedCoverage = null;
    this.cloud = new _ArticleFeedbackAgent.ArticleFeedbackAgent(userId, target, trackSubject);
    this.id = this.cloud.id;
  }

  /** Sibling titles from the story cluster, only when the chat opened from a Track tap. Failure is []. */
  getRelatedCoverage() {
    if (this.relatedCoverage) return this.relatedCoverage;
    const articleId = this.trackSubject?.articleId;
    const ownTitle = this.trackSubject?.title;
    this.relatedCoverage = !articleId ? Promise.resolve([]) : _articleService.ArticleService.getNewsClusterForArticle(articleId).then(cluster => {
      const titles = [];
      for (const a of cluster?.articles?.articles ?? []) {
        const title = a?.title_en_internal_only ?? a?.title ?? null;
        if (typeof title !== 'string') continue;
        const trimmed = title.trim();
        if (!trimmed || trimmed === ownTitle) continue;
        titles.push(trimmed);
        if (titles.length >= 5) break;
      }
      return titles;
    }).catch(() => []);
    return this.relatedCoverage;
  }

  /** The explicit track subject, else a minimal one from the target and the chat's title. */
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
  async context() {
    const [ctx, relatedCoverage, mistakes] = await Promise.all([(0, _articleSuggestionReads.getSuggestionFeedbackContext)(this.target), this.getRelatedCoverage(),
    // Read every turn; the reader never throws.
    (0, _articleFeedbackService.getRecentSystemMistakes)(3)]);
    const store = _floatingChatStore.useFloatingChatStore.getState();
    const chat = store.context.kind === 'article-suggestion' ? store.context : null;
    const subject = this.resolveTrackSubject();
    let alreadyFollowing = false;
    if (subject) alreadyFollowing = await (0, _trackActions.isSubjectTracked)(subject).catch(() => false);
    const s = ctx?.suggestion;
    return {
      today: (0, _run.today)(),
      published: day(subject?.pubDate),
      title: s?.title_en ?? s?.title_original ?? chat?.articleTitle ?? '(untitled)',
      publication: s?.publication_name ?? null,
      description: s?.description_en ?? null,
      category: ctx?.category ?? null,
      entities: ctx?.entities ?? [],
      relevance: s && s.status === _articleSuggestionStatus.ArticleSuggestionStatus.Complete ? s.relevance : null,
      note: s?.reason ?? null,
      matchedTopics: ctx?.matchedTopicTexts ?? [],
      producingFacts: (ctx?.linkedFacts ?? []).map(f => f.statement),
      relatedCoverage,
      alreadyFollowing,
      verdict: chat?.verdict ?? null,
      pending: (0, _shared.describePending)(store.proposal),
      answers: chat?.feedbackAnswers?.answers.map(a => a.cause === 'system' ? `${a.question} (Mera's mistake, changes nothing)` : `${a.question}${a.answer ? `: ${a.answer}` : ''} (applied)`),
      screen: chat?.feedbackAnswers?.screen,
      mistakes: mistakes.map(m => `${m.reason}; story from ${m.publication ?? 'a publication'}${part(m.country)}${part(m.language)}`)
    };
  }
  async respond(messages) {
    const context = await this.context();
    if ((0, _run.routeOf)('article', this.opts) === 'kev') {
      const proposal = _floatingChatStore.useFloatingChatStore.getState().proposal;
      const kev = await (0, _run.tryKev)('ArticleFeedbackOnDeviceAgent', () => (0, _kevSpec.runArticleKevTurn)({
        context,
        pendingTapOnly: proposal != null && (0, _proposals.proposalRequiresUserChoice)(proposal),
        languageName: (0, _run.appLanguageName)()
      }, messages, (0, _run.kevPorts)(this.opts)));
      if (kev) return kev;
    }
    const value = await (0, _run.respondStructured)((0, _articleFeedback.articleFeedbackInstructions)((0, _run.appLanguageName)()), _articleFeedback.ARTICLE_FEEDBACK_SCHEMA, budget => (0, _articleFeedback.buildArticleFeedbackPrompt)(context, (0, _run.chatTurns)(messages), budget));
    return (0, _articleFeedback.articleFeedbackTurn)(value, {
      matchedTopics: context.matchedTopics.slice(0, 6),
      publication: context.publication ?? null,
      hasPending: context.pending != null
    });
  }
  moreOptions(req) {
    const chat = _floatingChatStore.useFloatingChatStore.getState().context;
    const title = (chat.kind === 'article-suggestion' ? chat.articleTitle : undefined) ?? req.subject.title;
    return (0, _run.moreTrackOptions)(req, this.opts, title || undefined);
  }
  async executeTool(name, input) {
    return (await (0, _run.onDeviceTool)(name, input)) ?? this.cloud.executeTool(name, input);
  }
}
exports.ArticleFeedbackOnDeviceAgent = ArticleFeedbackOnDeviceAgent;