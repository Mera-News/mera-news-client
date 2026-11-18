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
  'PlaceSearch',
  'PublicationDisplayNames',
  'PublicationSourcesForNewsPublisher',
  'SearchNews',
];

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

const NEWS = new Set(NEWS_OPERATION_NAMES);

/** True only for an operation a news server may be sent. Unknown names are not news. */
export const isNewsOperation = (operationName: string | null | undefined): boolean => !!operationName && NEWS.has(operationName);
