// Where each GraphQL operation the client sends may go. A host that sends news to a server other than
// Mera's (a person's own news server, or a pod passing news through) forwards only NEWS operations.
// ACCOUNT and MERA_SERVICE operations always go to Mera and never to a news server: an account call
// carries the person's identity, and a Mera service (fact checks) is not something a news server offers.
// Every operation in the client's documents is in exactly one list; a test scans the documents.

export const NEWS_OPERATION_NAMES: readonly string[] = [
  'AllCountries',
  'ClusterMembershipsForArticles',
  'GetArticleById',
  'GetArticleIdsForPersona',
  'GetArticleIdsForTopics',
  'GetArticlesForCountry',
  'GetArticlesForPublisher',
  'GetArticlesForPublisherNoOrder',
  'GetArticlesForStories',
  'GetArticlesForStoriesLegacy',
  'GetArticlesForTopicsByIds',
  'GetArticlesForTopicsByIdsLegacy',
  'GetCanonicalTopics',
  'GetNewsClusterForArticle',
  'GetRecentArticleCount',
  'GetRelatedArticlesPage',
  'GetRelatedArticlesPageFiltered',
  'GetRelatedArticlesPageLegacy',
  'GetTopHeadlinesForCountry',
  'GetTopHeadlinesForCountryWindowed',
  'GetWorldHeadlines',
  'NewsServerStatus',
  'PlaceSearch',
  'PublicationDisplayNames',
  'PublicationSourcesForNewsPublisher',
  'SearchNews',
];

/**
 * News operations Mera's own server answers but the public news server does not, with why. A host
 * that checks news documents against the public news schema file checks these against Mera's schema instead.
 * The client's test fails when one of them starts to validate publicly, so this list cannot rot.
 */
export const NEWS_OPERATIONS_NOT_PUBLIC: Readonly<Record<string, string>> = {
  GetCanonicalTopics: 'held: the owner decides whether the canonical topic list is public',
  PublicationDisplayNames: 'private to Mera',
  GetArticleIdsForTopics: 'old topics fallback; whether to retire it is an open owner question',
};

/** News operations whose documents live in the app, not here. The app's own test checks them; a
 *  server that passes news through allows them with the list above. */
export const HOST_NEWS_OPERATION_NAMES: readonly string[] = ['GetNewsPublishers', 'PublicationProfile', 'SearchPublishers'];

export const ACCOUNT_OPERATION_NAMES: readonly string[] = [
  'ActiveFeedbackRequests',
  'AdvanceOnboardingStage',
  'DeleteExpoPushToken',
  'FeedbackTree',
  'GetReadingPlans',
  'GetUserPersona',
  'IssueLlmWarning',
  'RequestUnblock',
  'SubmitFeedbackResponse',
  'UnblockRequestStatus',
  'UpdateExpoPushToken',
  'UpdateNotificationWindow',
  'UpdateNotificationsEnabled',
  'UpdateProcessingMode',
  'UpdateUserConfig',
];

export const MERA_SERVICE_OPERATION_NAMES: readonly string[] = [
  'GetCachedFactCheck',
  'GetCachedFactCheckLegacy',
  'GetFactCheck',
  'GetFactCheckLegacy',
  'RequestFactCheckAgain',
];

const NEWS = new Set([...NEWS_OPERATION_NAMES, ...HOST_NEWS_OPERATION_NAMES]);

/** True only for an operation a news server may be sent. Unknown names are not news. */
export const isNewsOperation = (operationName: string | null | undefined): boolean => !!operationName && NEWS.has(operationName);
