"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isNewsOperation = exports.NEWS_OPERATION_NAMES = exports.MERA_SERVICE_OPERATION_NAMES = exports.HOST_NEWS_OPERATION_NAMES = exports.ACCOUNT_OPERATION_NAMES = void 0;
// Where each GraphQL operation the client sends may go. A host that sends news to a server other than
// Mera's (a person's own news server, or a pod passing news through) forwards only NEWS operations.
// ACCOUNT and MERA_SERVICE operations always go to Mera and never to a news server: an account call
// carries the person's identity, and a Mera service (fact checks) is not something a news server offers.
// Every operation in the client's documents is in exactly one list; a test scans the documents.

const NEWS_OPERATION_NAMES = exports.NEWS_OPERATION_NAMES = ['AllCountries', 'ClusterMembershipsForArticles', 'GetArticleById', 'GetArticleIdsForPersona', 'GetArticleIdsForTopics', 'GetArticlesForCountry', 'GetArticlesForPublisher', 'GetArticlesForPublisherNoOrder', 'GetArticlesForStories', 'GetArticlesForStoriesLegacy', 'GetArticlesForTopicsByIds', 'GetArticlesForTopicsByIdsLegacy', 'GetCanonicalTopics', 'GetNewsClusterForArticle', 'GetRecentArticleCount', 'GetRelatedArticlesPage', 'GetRelatedArticlesPageFiltered', 'GetRelatedArticlesPageLegacy', 'GetTopHeadlinesForCountry', 'GetTopHeadlinesForCountryWindowed', 'GetWorldHeadlines', 'PlaceSearch', 'PublicationDisplayNames', 'PublicationSourcesForNewsPublisher', 'SearchNews'];

/** News operations whose documents live in the app, not here. The app's own test checks them; a
 *  server that passes news through allows them with the list above. */
const HOST_NEWS_OPERATION_NAMES = exports.HOST_NEWS_OPERATION_NAMES = ['GetNewsPublishers', 'PublicationProfile', 'SearchPublishers'];
const ACCOUNT_OPERATION_NAMES = exports.ACCOUNT_OPERATION_NAMES = ['ActiveFeedbackRequests', 'AdvanceOnboardingStage', 'DeleteExpoPushToken', 'FeedbackTree', 'GetReadingPlans', 'GetUserPersona', 'IssueLlmWarning', 'RequestUnblock', 'SubmitFeedbackResponse', 'UnblockRequestStatus', 'UpdateExpoPushToken', 'UpdateNotificationWindow', 'UpdateNotificationsEnabled', 'UpdateProcessingMode', 'UpdateUserConfig'];
const MERA_SERVICE_OPERATION_NAMES = exports.MERA_SERVICE_OPERATION_NAMES = ['GetCachedFactCheck', 'GetCachedFactCheckLegacy', 'GetFactCheck', 'GetFactCheckLegacy', 'RequestFactCheckAgain'];
const NEWS = new Set([...NEWS_OPERATION_NAMES, ...HOST_NEWS_OPERATION_NAMES]);

/** True only for an operation a news server may be sent. Unknown names are not news. */
const isNewsOperation = operationName => !!operationName && NEWS.has(operationName);
exports.isNewsOperation = isNewsOperation;