"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.openArticleChat = openArticleChat;
exports.openFeedbackChatWithPath = openFeedbackChatWithPath;
exports.recordSwipeVerdict = recordSwipeVerdict;
exports.wireSwipeCallbacks = wireSwipeCallbacks;
var _feedbackSubject = require("../tracking/feedback-subject");
var _swipeCallbacks = require("./swipe-callbacks");
var _i18n = _interopRequireDefault(require("../platform/i18n"));
var _articleFeedbackService = require("../database/services/article-feedback-service");
var _feedbackTreeService = require("./feedback-tree-service");
var _logger = _interopRequireDefault(require("../logger"));
var _floatingChatStore = require("../stores/floating-chat-store");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// swipe-feedback — the Feed-tab signal-persistence layer.
//
// Verdict writes for the Feed's legacy verdict callbacks, and the Tell Mera
// chat hand-off. The feedback sheet (useArticleMenu) writes the verdict row
// itself on the reader's first answer, and the tree path with it.
//
// This is the wiring module for `swipe-callbacks.ts` — `wireSwipeCallbacks()`
// (called once by SwipeFeedScreen) replaces the no-op contract members with the
// real implementations below.

// Analytics surface tag. Historically the Tinder-style swipe deck; the deck was
// replaced by the vertical Feed, so this now tags the FEED's verdict row. Kept as
// 'swipe' deliberately — renaming it would fragment the live feedback analytics.
const SURFACE = 'swipe';

/** Records a fresh verdict. */
async function recordSwipeVerdict(suggestion, verdict) {
  const subject = (0, _feedbackSubject.feedbackSubjectFromSuggestion)(suggestion, SURFACE);
  await (0, _articleFeedbackService.recordVerdictFeedback)({
    articleId: subject.articleId,
    suggestionId: subject.suggestionId,
    sentiment: verdict,
    title: subject.title,
    origin: 'suggestion',
    surface: SURFACE,
    contextJson: (0, _feedbackSubject.buildContextJson)(subject)
  });
}

/**
 * Walks the tree along `pathIds`, resolving each tapped node to its localized
 * label. Stops at the first id that doesn't resolve (graceful degradation).
 */
function resolvePathLabels(rootNodes, pathIds, vars) {
  const labels = [];
  let level = rootNodes;
  for (const id of pathIds) {
    const node = level.find(n => n.id === id);
    if (!node) break;
    labels.push(_i18n.default.t(node.labelKey, {
      defaultValue: node.labelDefault,
      ...vars
    }));
    level = node.children ?? [];
  }
  return labels;
}

/**
 * Opens the Mera chat from a verdict + tapped path: resolves the path ids to
 * label breadcrumb, synthesizes the auto-sent initial message, and hands the
 * store an article-suggestion context carrying the verdict + label breadcrumb.
 * The store stays dumb — it just auto-sends the prebuilt message and threads the
 * context to the agent.
 */
async function openFeedbackChatWithPath(suggestion, verdict, path, answers) {
  // With answers, the breadcrumb is what the reader saw (labels rendered with
  // the fact and site filled in); a bare tree label would show its braces.
  let labels = answers ? answers.answers.map(a => a.answer ?? a.question) : [];
  if (!answers) {
    try {
      const tree = await (0, _feedbackTreeService.getFeedbackTree)();
      labels = resolvePathLabels(tree.root, path, {
        site: suggestion.publication_name ?? ''
      });
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          service: 'swipe-feedback',
          method: 'openChat.labels'
        }
      });
    }
  }
  const breadcrumb = labels.join(' → ');
  const hasPath = breadcrumb.length > 0;
  const initialMessage = hasPath ? _i18n.default.t('swipeFeed.chatHandoffDislike', {
    path: breadcrumb
  }) : _i18n.default.t('swipeFeed.chatHandoffDislikeNoPath');
  _floatingChatStore.useFloatingChatStore.getState().openArticleFeedback({
    kind: 'article-suggestion',
    articleId: suggestion.articleId,
    suggestionId: suggestion._id,
    articleTitle: suggestion.title_en ?? '',
    verdict,
    // treePath carries the human-readable breadcrumb LABELS (not ids) so the
    // agent's <context> and intro can use them directly without re-resolving.
    treePath: labels,
    ...(answers ? {
      feedbackAnswers: answers
    } : {})
  }, initialMessage);
}

/**
 * Opens the DEFAULT article chat from the VerdictBar's Mera icon: the article
 * context (pinned card) with the standard starter chips ("Why this?" / "Don't
 * want this") and NO auto-sent message — deliberately WITHOUT the verdict/tapped
 * path, so it is a plain conversation about the article rather than the tree's
 * "convert my taps into a conversation" handoff. `expand` starts a fresh thread
 * (nulling any pending auto-send) whenever the context differs.
 */
function openArticleChat(suggestion) {
  _floatingChatStore.useFloatingChatStore.getState().expand({
    kind: 'article-suggestion',
    articleId: suggestion.articleId,
    suggestionId: suggestion._id,
    articleTitle: suggestion.title_en ?? ''
  });
}

/** Installs the real Feed-signal implementations onto the swipe-callbacks contract. */
function wireSwipeCallbacks() {
  _swipeCallbacks.swipeCallbacks.onVerdict = (suggestion, verdict) => {
    void recordSwipeVerdict(suggestion, verdict);
  };
  _swipeCallbacks.swipeCallbacks.onInvokeMera = (suggestion, verdict, path, answers) => {
    void openFeedbackChatWithPath(suggestion, verdict, path, answers);
  };
  _swipeCallbacks.swipeCallbacks.onOpenArticleChat = suggestion => {
    openArticleChat(suggestion);
  };
}