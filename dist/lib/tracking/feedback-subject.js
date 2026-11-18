"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildContextJson = buildContextJson;
exports.feedbackSubjectFromSuggestion = feedbackSubjectFromSuggestion;
// FeedbackSubject — the origin-aware descriptor every card action row is given.
//
// A single value type that tells the universal actions (useArticleActions,
// useArticleMenu) WHAT it is acting on and WHERE the action was taken, so
// like/dislike/save/share can be persisted with provenance (origin + surface +
// a context snapshot) regardless of whether the underlying content is a
// personalized ForYouSuggestion or a standalone NewsArticle.

/** The on-screen surface the action was taken on. Open string union so future
 *  surfaces (e.g. a new tab) can pass their own key without a type change. */

/**
 * Snapshot the subject's contextual extras for the persisted feedback row's
 * `context_json`. Shared by every actions surface (the compact rows / the swipe feed) so the stored
 * provenance shape is identical everywhere.
 */
function buildContextJson(subject) {
  const snapshot = {};
  if (subject.scopeKey) snapshot.scopeKey = subject.scopeKey;
  if (subject.stableClusterId) snapshot.stableClusterId = subject.stableClusterId;
  if (subject.eventType) snapshot.eventType = subject.eventType;
  if (subject.category) snapshot.category = subject.category;
  // Keyed `publication` (not `publicationName`) to match the field name the
  // feedback-digest's DigestSignalContext / optimisation-plan-service reader
  // already expect.
  if (subject.publicationName) snapshot.publication = subject.publicationName;
  // Top-level `country` / `language`: persona's `mistakeFromContext` reads them
  // for a "Mera's mistake" record kept on device.
  if (subject.countryCode) snapshot.country = subject.countryCode;
  if (subject.languageCode) snapshot.language = subject.languageCode;
  if (typeof subject.relevance === 'number') snapshot.relevance = subject.relevance;
  if (subject.matchedTopics && subject.matchedTopics.length > 0) {
    snapshot.matchedTopics = subject.matchedTopics;
  }
  if (subject.entities && subject.entities.length > 0) {
    snapshot.entities = subject.entities;
  }
  return Object.keys(snapshot).length > 0 ? JSON.stringify(snapshot) : null;
}

/**
 * Builds a suggestion-origin {@link FeedbackSubject} from a ForYouSuggestion.
 * Mirrors the descriptor ArticleSuggestionCard assembles so the feed's
 * verdict/tree persistence carries identical provenance.
 */
function feedbackSubjectFromSuggestion(suggestion, surface,
/** Fields the caller resolved that a `ForYouSuggestion` does not carry.
 *  `category` lives on the `article_suggestions` ROW, not on the projected
 *  suggestion, so only a caller that read the row (via
 *  `getSuggestionFeedbackContext`) can supply it — and without it
 *  `buildContextJson` drops the category the digest's category-suppression
 *  candidates key on. */
extras) {
  return {
    origin: 'suggestion',
    surface,
    category: extras?.category ?? null,
    articleId: suggestion.articleId,
    suggestionId: suggestion._id,
    title: suggestion.title_en ?? '',
    pubDate: suggestion.firstPubDate ?? null,
    publicationName: suggestion.publication_name,
    countryCode: suggestion.country_code,
    languageCode: suggestion.language_code,
    stableClusterId: suggestion.clusters?.find(c => c.stableClusterId)?.stableClusterId ?? undefined,
    eventType: suggestion.eventType ?? undefined,
    matchedTopics: suggestion.matchedTopics,
    entities: suggestion.entities,
    relevance: suggestion.relevance
  };
}