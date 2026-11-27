"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.UnblockRequestStatus = exports.RelatedSortMode = exports.PublisherArticleOrder = exports.ProcessingMode = exports.OnboardingStage = exports.HeadlineScope = exports.ArticleProcessingStatus = exports.AppPlatform = void 0;
/** All built-in and custom scalars, mapped to their actual values */
/** Static client configuration that does not depend on the caller. Currently the version stamps of the published legal documents. */
/** Mobile app platform the version check is being made for. */
let AppPlatform = exports.AppPlatform = /*#__PURE__*/function (AppPlatform) {
  /** Google Android — directs to the Play Store. */
  AppPlatform["Android"] = "ANDROID";
  /** Apple iOS — directs to the App Store. */
  AppPlatform["Ios"] = "IOS";
  return AppPlatform;
}({});
/** One article's cluster memberships from the newest COMPLETE clustering generation. */
/** Status of article processing through the pipeline */
let ArticleProcessingStatus = exports.ArticleProcessingStatus = /*#__PURE__*/function (ArticleProcessingStatus) {
  ArticleProcessingStatus["AggregationEnqueued"] = "AGGREGATION_ENQUEUED";
  ArticleProcessingStatus["AggregationFailed"] = "AGGREGATION_FAILED";
  ArticleProcessingStatus["AggregationSuccessful"] = "AGGREGATION_SUCCESSFUL";
  ArticleProcessingStatus["DetectLanguageEnqueued"] = "DETECT_LANGUAGE_ENQUEUED";
  ArticleProcessingStatus["DetectLanguageFailed"] = "DETECT_LANGUAGE_FAILED";
  ArticleProcessingStatus["DetectLanguageSuccessful"] = "DETECT_LANGUAGE_SUCCESSFUL";
  ArticleProcessingStatus["EmbeddingEnqueued"] = "EMBEDDING_ENQUEUED";
  ArticleProcessingStatus["EmbeddingFailed"] = "EMBEDDING_FAILED";
  ArticleProcessingStatus["EmbeddingSuccessful"] = "EMBEDDING_SUCCESSFUL";
  ArticleProcessingStatus["Pending"] = "PENDING";
  ArticleProcessingStatus["TranslationEnqueued"] = "TRANSLATION_ENQUEUED";
  ArticleProcessingStatus["TranslationFailed"] = "TRANSLATION_FAILED";
  ArticleProcessingStatus["TranslationSkipped"] = "TRANSLATION_SKIPPED";
  ArticleProcessingStatus["TranslationSuccess"] = "TRANSLATION_SUCCESS";
  return ArticleProcessingStatus;
}({});
/** Sibling article returned by the relatedArticles query */
/** Article summary with cluster membership — used by Flow v2 hydration */
/** Hydrated articles for a set of IDs, plus the daily-delivery-cap signal. The cap is charged here (delivery point), so a clipped response means the user hit their daily article limit — distinct from IDs that simply TTL'd out. */
/** Membership of an article in a cluster, with the HDBSCAN confidence (0.0–1.0) */
/** A cached, cross-user fact check keyed on the article URL. Poll until status is complete / blocked / failed. */
/** A grounding source. `uri` is a Google redirect wrapper, stored verbatim. */
/** One checkable assertion lifted out of the article. */
/** An established fact-checking organisation that has published on this claim, with its OWN verdict quoted verbatim (never mapped onto the FactCheck verdict vocabulary). */
/** Versioned feedback-tree config. When the client already holds the current version, treeJson is "" (not-modified) and only the version metadata is sent. */
/** A geo tag on an article (written by the tagging pipeline). city/region are optional; countryCode is always present. */
/** Top-headlines scope. COUNTRY requires countryCode; GLOBAL takes none. */
let HeadlineScope = exports.HeadlineScope = /*#__PURE__*/function (HeadlineScope) {
  HeadlineScope["Country"] = "COUNTRY";
  HeadlineScope["Global"] = "GLOBAL";
  return HeadlineScope;
}({});
/** A single top-headlines scope. COUNTRY requires countryCode; GLOBAL takes none. */
/** Top-headline article ids for one scope. clusterSizes and stableClusterIds are positionally aligned with articleIds. */
/** A hybrid (text + semantic) search hit. Deliberately headline-only: hydrate the ids you want through articlesForTopicsByIds to get body text and the link. */
/** Monotonic onboarding progress marker. Values: NOTIFICATIONS, PROCESSING_MODE, PERSONA_CHAT, FINISHED. The user resumes at this stage on app launch; only FINISHED skips the wizard. */
let OnboardingStage = exports.OnboardingStage = /*#__PURE__*/function (OnboardingStage) {
  OnboardingStage["Finished"] = "FINISHED";
  OnboardingStage["Notifications"] = "NOTIFICATIONS";
  OnboardingStage["PersonaChat"] = "PERSONA_CHAT";
  OnboardingStage["ProcessingMode"] = "PROCESSING_MODE";
  return OnboardingStage;
}({});
/** Per-article match metadata. textScore is ALWAYS null in v1. stableClusterId is the id of the article's largest-clusterSize linked cluster, null when the article is a singleton/unclustered. */
/** Privacy-lean persona query: topic texts + optional top-headlines scopes. No locations, weights, or exclude-topics are ever accepted here (deliberate). */
/** Privacy-lean persona query result: per-topic article ids + match metadata, plus optional per-scope top headlines. */
/** A single persona topic. `limit` overrides the query-level limitPerTopic; `afterCursor` is the articleId of the last item on the previous page. */
/** Resolved article ids + match metadata for one persona topic. */
/** Which inference backend handles Mera Protocol work for this user. ON_DEVICE runs fully offline on the user device; CLOUD uses end-to-end encrypted inference. */
let ProcessingMode = exports.ProcessingMode = /*#__PURE__*/function (ProcessingMode) {
  ProcessingMode["Cloud"] = "CLOUD";
  ProcessingMode["OnDevice"] = "ON_DEVICE";
  return ProcessingMode;
}({});
/** A publication (a publisher, not a feed) as shown on the publication page. */
/** Ordering for articlesForPublisher. */
let PublisherArticleOrder = exports.PublisherArticleOrder = /*#__PURE__*/function (PublisherArticleOrder) {
  /** Newest first across all feeds over 48h, deduped by canonical URL, at most 50 per page. */
  PublisherArticleOrder["Newest"] = "NEWEST";
  /** Last 24h ranked by largest cluster size (the original behaviour). */
  PublisherArticleOrder["TopHeadlines"] = "TOP_HEADLINES";
  return PublisherArticleOrder;
}({});
/** Each plan's cloud reading per UTC day, in decimal bytes. */
/** Country and language counts over the related set. Each dimension is counted with the filter of the other dimension applied. */
/** Anonymous, ephemeral reader signals used to order the RELEVANCE mode. Never persisted, never cached, never linked to a user. */
/** One page of sibling coverage for an article, already ordered server-side. */
/** One chip for the related-coverage filters, with its row count. */
/** Ordering for relatedArticlesPage. RELEVANCE ranks the reader's publications and language; the two date modes are flat. */
let RelatedSortMode = exports.RelatedSortMode = /*#__PURE__*/function (RelatedSortMode) {
  /** Flat publish-date descending. Undated rows sort last here too, so NEWEST is not the exact reverse of OLDEST. */
  RelatedSortMode["Newest"] = "NEWEST";
  /** Flat publish-date ascending. Undated rows sort last. */
  RelatedSortMode["Oldest"] = "OLDEST";
  /** Default. Subscribed publications, then preferred publications, then the reader app language, then newest first. Country is not a key. The only mode that consults the reader context. */
  RelatedSortMode["Relevance"] = "RELEVANCE";
  return RelatedSortMode;
}({});
/** One top-headline slot: the representative article plus its cluster metadata (stableClusterId, clusterSize). Both are null/0 for an unclustered singleton. */
/** Optional top-headlines block. Up to 6 scopes; limitPerScope capped at 25. */
/** Review state of an LLM unblock request. PENDING awaits manual review; APPROVED/REJECTED are terminal. */
let UnblockRequestStatus = exports.UnblockRequestStatus = /*#__PURE__*/function (UnblockRequestStatus) {
  UnblockRequestStatus["Approved"] = "APPROVED";
  UnblockRequestStatus["Pending"] = "PENDING";
  UnblockRequestStatus["Rejected"] = "REJECTED";
  return UnblockRequestStatus;
}({});