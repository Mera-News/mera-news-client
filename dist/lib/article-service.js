"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RELATED_FILTERS_LIVE = exports.MAX_TOPICS_PER_BATCH = exports.MAX_CLUSTER_MEMBERSHIP_IDS = exports.ArticleService = void 0;
exports.__resetClusterMembershipsSupport = __resetClusterMembershipsSupport;
exports.__resetExploreWindowSupport = __resetExploreWindowSupport;
exports.__resetPublisherOrderSupport = __resetPublisherOrderSupport;
exports.__resetRelatedOriginalSupport = __resetRelatedOriginalSupport;
exports.__resetStoryKeySupport = __resetStoryKeySupport;
exports.__resetWorldTopicsSupport = __resetWorldTopicsSupport;
exports.default = void 0;
var _client = require("@apollo/client");
var _apolloClient = _interopRequireDefault(require("./platform/apollo-client"));
var _logger = _interopRequireDefault(require("./logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// GraphQL Query for fetching a single article by ID.
const GET_ARTICLE_BY_ID = (0, _client.gql)`
  query GetArticleById($id: ID!) {
    articleById(id: $id) {
      _id
      title
      title_en_internal_only
      description
      description_en_internal_only
      pubDate
      article_url
      image_url
      creator
      source_uri
      original_language_code
      # The ARTICLE's own classification — needed by the detail screen's
      # feedback surface, which has no local article_suggestions row to derive
      # from for a standalone article (Explore / tracked story / shared link).
      # NOT interchangeable with publicationSource.category below: that one is
      # the PUBLICATION's category.
      category
      entities
      event_type
      geo_tags {
        city
        region
        countryCode
      }
      publicationSource {
        _id
        publication_name
        publication_url
        country_code
        country_name
        category
        detected_language_code
        feed_language_code
      }
    }
  }
`;

// GraphQL Query for a country's "top headlines": last-24h articles across all
// the country's sources, sorted by largest cluster size (server-side global
// sort). A null/"GLOBAL" countryCode spans all countries.
const GET_ARTICLES_FOR_COUNTRY = (0, _client.gql)`
  query GetArticlesForCountry($countryCode: String, $first: Int, $after: String) {
    articlesForCountry(countryCode: $countryCode, first: $first, after: $after) {
      articles {
        _id
        title
        title_en_internal_only
        description
        description_en_internal_only
        pubDate
        article_url
        image_url
        creator
        source_uri
        original_language_code
        geo_tags {
          city
          region
          countryCode
        }
        event_type
        entities
        publicationSource {
          _id
          publication_name
          country_code
        }
      }
      pageInfo {
        endCursor
        hasNextPage
        pageSize
      }
    }
  }
`;

// GraphQL Query for a country's precomputed, cluster-deduplicated top
// headlines (each big story appears once), paged over the materialized
// edition. A null/"GLOBAL" countryCode spans all countries. Falls back to the
// live path (editionBuiltAt: null) when no edition exists yet. Mirrors
// GET_ARTICLES_FOR_COUNTRY's article field set inside each headline slot.
const TOP_HEADLINES_SELECTION = `
      headlines {
        stableClusterId
        clusterSize
        article {
          _id
          title
          title_en_internal_only
          description
          description_en_internal_only
          pubDate
          article_url
          image_url
          creator
          source_uri
          original_language_code
          geo_tags {
            city
            region
            countryCode
          }
          event_type
          entities
          publicationSource {
            _id
            publication_name
            country_code
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      editionBuiltAt
`;
const GET_TOP_HEADLINES_FOR_COUNTRY = (0, _client.gql)`
  query GetTopHeadlinesForCountry($countryCode: String, $first: Int, $after: String) {
    topHeadlinesForCountry(countryCode: $countryCode, first: $first, after: $after) {
${TOP_HEADLINES_SELECTION}    }
  }
`;

// The same page, with Explore's 6/12/24/48h window. A SEPARATE
// document: a server that predates `windowHours` rejects the whole request,
// so the plain one above stays valid against it (see exploreWindowUnsupported).
const GET_TOP_HEADLINES_FOR_COUNTRY_WINDOWED = (0, _client.gql)`
  query GetTopHeadlinesForCountryWindowed($countryCode: String, $first: Int, $after: String, $windowHours: Int) {
    topHeadlinesForCountry(countryCode: $countryCode, first: $first, after: $after, windowHours: $windowHours) {
${TOP_HEADLINES_SELECTION}    }
  }
`;

// ---- World topic filter -------------------------------------------------------
/** A World page from `worldHeadlines`, or from the country document on an old
 *  server (`topicsSupported: false`, no facets). */

const GET_CANONICAL_TOPICS = (0, _client.gql)`
  query GetCanonicalTopics($level: Int) {
    canonicalTopics(level: $level) {
      id
      path
      label
      level
      parentId
    }
  }
`;
const GET_WORLD_HEADLINES = (0, _client.gql)`
  query GetWorldHeadlines($countryCode: String, $first: Int, $after: String, $windowHours: Int, $canonicalTopicIds: [ID!]) {
    worldHeadlines(countryCode: $countryCode, first: $first, after: $after, windowHours: $windowHours, canonicalTopicIds: $canonicalTopicIds) {
${TOP_HEADLINES_SELECTION}      facets {
        topicId
        count
      }
    }
  }
`;

/** True once the server rejected worldHeadlines / canonicalTopics as unknown: the old documents serve the list for the session. */
let worldTopicsUnsupported = false;
let canonicalTopicsCache = null;

/** Test seam. */
function __resetWorldTopicsSupport() {
  worldTopicsUnsupported = false;
  canonicalTopicsCache = null;
}

// A publisher's articles across all its feeds, one page. The selection is
// shared by the two documents below; `check:schema` inlines it.
const PUBLISHER_ARTICLE_FIELDS = `
      articles {
        _id
        title
        title_en_internal_only
        description
        description_en_internal_only
        pubDate
        article_url
        image_url
        creator
        source_uri
        original_language_code
        publicationSource {
          _id
          publication_name
          country_code
        }
      }
      pageInfo {
        endCursor
        hasNextPage
        pageSize
      }
`;

// With `order`: NEWEST (the full 48h, newest first) or TOP_HEADLINES (last
// 24h ranked by cluster size, the server default).
const GET_ARTICLES_FOR_PUBLISHER = (0, _client.gql)`
  query GetArticlesForPublisher(
    $newsPublisherId: ID!
    $first: Int
    $after: String
    $order: PublisherArticleOrder
  ) {
    articlesForPublisher(newsPublisherId: $newsPublisherId, first: $first, after: $after, order: $order) {
      ${PUBLISHER_ARTICLE_FIELDS}
    }
  }
`;

// The same query WITHOUT `order`, for a server that predates the argument (an
// OTA ahead of its server). GraphQL validates the whole document before any
// directive applies, so `@include` cannot hide an unknown argument: a second
// document is the only way. It always answers top headlines.
const GET_ARTICLES_FOR_PUBLISHER_NO_ORDER = (0, _client.gql)`
  query GetArticlesForPublisherNoOrder($newsPublisherId: ID!, $first: Int, $after: String) {
    articlesForPublisher(newsPublisherId: $newsPublisherId, first: $first, after: $after) {
      ${PUBLISHER_ARTICLE_FIELDS}
    }
  }
`;

// GraphQL Query for the live cluster an article currently belongs to (via its
// newest cluster-article-link). Null when the article is unclustered or its
// cluster has aged out. The follow-a-story flow uses it to read a story's
// current member articles (to ground the LLM's scope-pill proposals). Selects
// the full article shape, plus stableClusterId/clusterSize.
const GET_NEWS_CLUSTER_FOR_ARTICLE = (0, _client.gql)`
  query GetNewsClusterForArticle($articleId: ID!, $first: Int, $after: String) {
    newsClusterForArticle(articleId: $articleId) {
      _id
      stableClusterId
      clusterSize
      createdAt
      updatedAt
      articles(first: $first, after: $after) {
        articles {
          _id
          title
          title_en_internal_only
          description
          description_en_internal_only
          pubDate
          article_url
          image_url
          creator
          source_uri
          original_language_code
          clusterConfidence
          publicationSource {
            _id
            publication_name
            publication_url
            country_code
            country_name
            category
            detected_language_code
            feed_language_code
          }
        }
        pageInfo {
          endCursor
          hasNextPage
          pageSize
        }
      }
    }
  }
`;

// (removed: trackStory / trackedStory — followed stories are now pure on-device
// topics, grown by the persona query each fetch cycle; no server archive.)

// (removed: GET_SERVER_PROCESSING_METADATA_FOR_USER — serverProcessingMetadataForUser no longer exists)

// Placeholder to keep line reference intact

// One ORDERED page of sibling coverage for an article, for the detail screens'
// "Related articles" section.
//
// The server owns the ordering. It has to: the country-block order ranks each
// block by its size across the whole candidate set, so a page's order depends on
// rows that are not in it, and ordering client-side after paging would produce
// blocks sized to whatever 10 rows happened to arrive. `context` carries the
// reader's geo/language signals for that ordering — anonymous, ephemeral, and
// deliberately not part of any server cache key.
//
// The unpaged `relatedArticles` query still exists server-side for bundles
// already in the field, but nothing in this build calls it.
const GET_RELATED_ARTICLES_PAGE = (0, _client.gql)`
  query GetRelatedArticlesPage(
    $articleId: ID!
    $stableClusterId: String
    $sortMode: RelatedSortMode
    $context: RelatedArticlesContextInput
    $excludeIds: [ID!]
    $first: Int
    $after: String
  ) {
    relatedArticlesPage(
      articleId: $articleId
      stableClusterId: $stableClusterId
      sortMode: $sortMode
      context: $context
      excludeIds: $excludeIds
      first: $first
      after: $after
    ) {
      articles {
        _id
        title_en
        title_original
        description_en
        article_url
        image_url
        country_code
        publication_name
        language_code
        pubDate
      }
      pageInfo {
        endCursor
        hasNextPage
        pageSize
      }
      restarted
    }
  }
`;

// The same page without `title_original`, for a server that predates it (see
// relatedOriginalUnsupported): an unknown field fails the whole request.
const GET_RELATED_ARTICLES_PAGE_LEGACY = (0, _client.gql)`
  query GetRelatedArticlesPageLegacy(
    $articleId: ID!
    $stableClusterId: String
    $sortMode: RelatedSortMode
    $context: RelatedArticlesContextInput
    $excludeIds: [ID!]
    $first: Int
    $after: String
  ) {
    relatedArticlesPage(
      articleId: $articleId
      stableClusterId: $stableClusterId
      sortMode: $sortMode
      context: $context
      excludeIds: $excludeIds
      first: $first
      after: $after
    ) {
      articles {
        _id
        title_en
        description_en
        article_url
        image_url
        country_code
        publication_name
        language_code
        pubDate
      }
      pageInfo {
        endCursor
        hasNextPage
        pageSize
      }
      restarted
    }
  }
`;

/**
 * related-coverage filters: THE switch. The server's `countries` /
 * `languages` arguments and `facets` field may be absent on an older server, and
 * an unknown argument or field fails the WHOLE request, so a validation failure
 * on the filtered document latches `relatedFiltersUnsupported` for the session
 * and the default document is sent instead (facets null). While false,
 * `getRelatedArticlesPage` sends the default document whatever the caller
 * passes, and the filter chips should read this to decide whether to render.
 */
const RELATED_FILTERS_LIVE = exports.RELATED_FILTERS_LIVE = true;

/** A reader's related-coverage filter. Absent or empty list means "All". */

/** A related page as the service returns it: `facets` is null whenever the
 *  filtered document was not sent (switch off). */

/** Variables of GET_RELATED_ARTICLES_PAGE_FILTERED. Declared so the object
 *  literal gets excess-property checking: a typo'd key must not compile and
 *  then take the query down at runtime. */

// Same page as GET_RELATED_ARTICLES_PAGE plus the related-coverage filters and facet counts.
// A SEPARATE document on purpose: the default one must stay valid against a
// server that has never heard of either (see RELATED_FILTERS_LIVE).
const GET_RELATED_ARTICLES_PAGE_FILTERED = (0, _client.gql)`
  query GetRelatedArticlesPageFiltered(
    $articleId: ID!
    $stableClusterId: String
    $sortMode: RelatedSortMode
    $context: RelatedArticlesContextInput
    $excludeIds: [ID!]
    $first: Int
    $after: String
    $countries: [String!]
    $languages: [String!]
  ) {
    relatedArticlesPage(
      articleId: $articleId
      stableClusterId: $stableClusterId
      sortMode: $sortMode
      context: $context
      excludeIds: $excludeIds
      first: $first
      after: $after
      countries: $countries
      languages: $languages
    ) {
      articles {
        _id
        title_en
        title_original
        description_en
        article_url
        image_url
        country_code
        publication_name
        language_code
        pubDate
      }
      pageInfo {
        endCursor
        hasNextPage
        pageSize
      }
      restarted
      facets {
        countries {
          code
          count
        }
        languages {
          code
          count
        }
      }
    }
  }
`;

/** A non-empty filter list, or null ("All"). */
function filterList(v) {
  return v && v.length > 0 ? v : null;
}
const GET_RECENT_ARTICLE_COUNT = (0, _client.gql)`
  query GetRecentArticleCount {
    recentArticleCount
  }
`;

// [Flow v2] GraphQL Query: per-topic article IDs with cursor-based pagination.
// The server checks Redis (30 min TTL) first; on miss it runs a vector search
// with a hardcoded 24h cutoff. The app diffs the returned IDs against its
// local DB and only fetches missing full records via articlesForTopicsByIds.
const GET_ARTICLE_IDS_FOR_TOPICS = (0, _client.gql)`
  query GetArticleIdsForTopics($topics: [TopicPaginationInput!]!, $limitPerTopic: Int) {
    articleIdsForTopics(topics: $topics, limitPerTopic: $limitPerTopic) {
      results {
        topicText
        articleIds
        hasNextPage
        nextCursor
      }
    }
  }
`;

// [Flow v2] GraphQL Query: hydrate full article records for IDs the app
// doesn't already have locally. Returns ArticleWithClusters which includes
// per-cluster membership confidence for the For-You feed's collapse logic.
// A server that still caps downloads answers with fewer articles, never an
// error. Its `dailyLimitReached`/`resetAt` are not selected: nothing reads them.
const ARTICLE_HYDRATION_FIELDS = `
        _id
        clusters {
          clusterId
          confidence
          stableClusterId
        }
        title_en
        title
        description_en
        article_url
        image_url
        country_code
        publication_name
        language_code
        pubDate
        geo_tags {
          city
          region
          countryCode
        }
        entities
        event_type
        category
        maxClusterSize
`;
const GET_ARTICLES_FOR_TOPICS_BY_IDS = (0, _client.gql)`
  query GetArticlesForTopicsByIds($articleIds: [ID!]!) {
    articlesForTopicsByIds(articleIds: $articleIds) {
      articles {
        ${ARTICLE_HYDRATION_FIELDS}
        story_key
      }
    }
  }
`;

// The same page without `story_key`, for a server that predates it (see
// storyKeyUnsupported): an unknown field fails the whole request.
const GET_ARTICLES_FOR_TOPICS_BY_IDS_LEGACY = (0, _client.gql)`
  query GetArticlesForTopicsByIdsLegacy($articleIds: [ID!]!) {
    articlesForTopicsByIds(articleIds: $articleIds) {
      articles {
        ${ARTICLE_HYDRATION_FIELDS}
      }
    }
  }
`;

// Quota-EXEMPT sibling of GET_ARTICLES_FOR_TOPICS_BY_IDS, for articles
// that reached the device ONLY because the user follows a story. Identical
// selection set; this query is never charged against a daily article limit.
const GET_ARTICLES_FOR_STORIES = (0, _client.gql)`
  query GetArticlesForStories($articleIds: [ID!]!) {
    articlesForStories(articleIds: $articleIds) {
      articles {
        ${ARTICLE_HYDRATION_FIELDS}
        story_key
      }
    }
  }
`;
const GET_ARTICLES_FOR_STORIES_LEGACY = (0, _client.gql)`
  query GetArticlesForStoriesLegacy($articleIds: [ID!]!) {
    articlesForStories(articleIds: $articleIds) {
      articles {
        ${ARTICLE_HYDRATION_FIELDS}
      }
    }
  }
`;

// The current memberships of articles already on the device, from the newest
// COMPLETE clustering generation. An article left out of the answer has no complete
// generation (keep its value); `clusters: []` means it has no links (clear).
const GET_CLUSTER_MEMBERSHIPS_FOR_ARTICLES = (0, _client.gql)`
  query ClusterMembershipsForArticles($articleIds: [ID!]!) {
    clusterMembershipsForArticles(articleIds: $articleIds) {
      articleId
      clusters {
        clusterId
        confidence
        stableClusterId
      }
    }
  }
`;

// [Persona v3] Privacy-lean candidate listing: topic texts + limits +
// COUNTRY/GLOBAL headline scopes only (NO locations/weights/negatives ever leave
// the device). The server stores nothing and charges no quota here (quota is
// charged at hydration). Response carries per-topic matchMeta (vectorScore +
// stableClusterId) and separate per-scope headlineResults.
const GET_ARTICLE_IDS_FOR_PERSONA = (0, _client.gql)`
  query GetArticleIdsForPersona($query: PersonaQueryInput!) {
    articleIdsForPersona(query: $query) {
      topicResults {
        topicText
        articleIds
        matchMeta {
          articleId
          vectorScore
          textScore
          stableClusterId
        }
        nextCursor
        hasNextPage
      }
      headlineResults {
        scope
        countryCode
        articleIds
        clusterSizes
        stableClusterIds
      }
    }
  }
`;

// Use generated GraphQL types

// [Flow v2] The server rejects an articleIdsForTopics request carrying more than
// 200 topics with BAD_USER_INPUT. Users accumulate unbounded on-device topics,
// so a single feed-sync could send hundreds at once. We chunk below the server
// cap (with headroom) and run the batches SEQUENTIALLY — each cold topic costs
// the server a Jina embed + vector search, so parallel batches would spike load.
const MAX_TOPICS_PER_BATCH = exports.MAX_TOPICS_PER_BATCH = 150;

/** How a publisher's articles are ordered (`articlesForPublisher(order:)`),
 *  as the string values of the generated enum. */

/** One page of a publisher's articles, and whether `order` was honoured. */

/** Session flag: the server rejected `order` once. Never persisted. */
let publisherOrderUnsupported = false;

/** Test seam. */
function __resetPublisherOrderSupport() {
  publisherOrderUnsupported = false;
}

/**
 * True once the server rejected Explore's `windowHours` argument as unknown:
 * this bundle is ahead of its server, so ask the plain document for the rest
 * of the session. Without it an OTA landing before the server would blank
 * every Explore list.
 */
let exploreWindowUnsupported = false;

/** Test seam. */
function __resetExploreWindowSupport() {
  exploreWindowUnsupported = false;
}

/**
 * True once the server rejected `ArticleSummary.title_original` on the related
 * page: ask the legacy document for the rest of the session, so an app ahead of
 * its server still lists related coverage (titles then fall back to English).
 */
let relatedOriginalUnsupported = false;

/** Test seam. */
function __resetRelatedOriginalSupport() {
  relatedOriginalUnsupported = false;
  relatedFiltersUnsupported = false;
}

/** True once the server rejected the filtered related document: default document for the session. */
let relatedFiltersUnsupported = false;

/**
 * True once the server rejected `ArticleWithClusters.story_key`: hydrate with
 * the Legacy documents for the rest of the session (rows then persist a null
 * story_key, which only drops the dedup edge and ages out in 48h).
 */
let storyKeyUnsupported = false;

/** Test seam. */
function __resetStoryKeySupport() {
  storyKeyUnsupported = false;
}

/** True once the server rejected `clusterMembershipsForArticles`: no refresh this session. */
let clusterMembershipsUnsupported = false;

/** Test seam. */
function __resetClusterMembershipsSupport() {
  clusterMembershipsUnsupported = false;
}

/** The server rejects more than this many ids with BAD_USER_INPUT. */
const MAX_CLUSTER_MEMBERSHIP_IDS = exports.MAX_CLUSTER_MEMBERSHIP_IDS = 500;

/** One hydration chunk. Concurrent workers that fail before the latch lands each fall back on their own, which is harmless. */
async function hydrateBatch(field, doc, legacyDoc, articleIds) {
  if (!storyKeyUnsupported) {
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: doc,
        variables: {
          articleIds
        },
        fetchPolicy: 'no-cache',
        context: {
          expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
        }
      });
      return data?.[field]?.articles ?? [];
    } catch (error) {
      if (!graphQLErrorCodes(error).includes('GRAPHQL_VALIDATION_FAILED')) throw error;
      storyKeyUnsupported = true;
      _logger.default.info('[ArticleService] server has no ArticleWithClusters.story_key; legacy hydration documents this session');
    }
  }
  const {
    data
  } = await _apolloClient.default.query({
    query: legacyDoc,
    variables: {
      articleIds
    },
    fetchPolicy: 'no-cache'
  });
  return data?.[field]?.articles ?? [];
}

/** GraphQL error codes on a rejection (Apollo 4 `errors`, Apollo 3 `graphQLErrors`). */
function graphQLErrorCodes(err) {
  if (!err || typeof err !== 'object') return [];
  const list = err.errors ?? err.graphQLErrors;
  if (!Array.isArray(list)) return [];
  return list.map(e => e?.extensions?.code).filter(c => typeof c === 'string');
}

// `isUnauthenticatedError` used to be defined here, then moved to
// `lib/utils/retry.ts`. This module no longer applies it at all: every read
// query below goes through the Apollo error link, which owns the 401 rule (and
// every other suppression class) via `classifySuppression` in lib/logger.ts.

// Article Service Class
class ArticleService {
  /**
   * One error-reporting policy for every read query below. Extracted because
   * the rule has to be identical at eleven catch sites — copies of it would
   * drift, and a single drifting copy is enough to re-open a storm.
   *
   * THIS NO LONGER CAPTURES. It leaves a breadcrumb and nothing else.
   *
   * Every one of the eleven callers wraps `client.query`, so the Apollo error
   * link (lib/apollo-client.ts) has ALREADY seen and classified the failure
   * before the rejection reaches us: it owns the Sentry capture, the
   * server-reachability signal, the auth breaker and the sync-failed banner.
   * Capturing again here only bought a second event for one failure — and
   * where the caller reports too (ScopeArticleList catches the rethrow and
   * captures a third time), a third. That is Sentry MERA-APP-77: the tag
   * `service=article-service` on those events is this method, firing above a
   * link that had already suppressed its own capture for being offline.
   *
   * The 401 branch is gone with it. It existed to keep a dead session from
   * spending an event per query, and the link's UNAUTHENTICATED branch now
   * covers both the `code` and the `statusCode` shape, so a second
   * recordAuthFailure() here would only double-count into the same breaker.
   *
   * CONTROL FLOW IS UNCHANGED and must stay that way: ten callers rethrow
   * after calling this, `getRecentArticleCount` returns null, and the Explore
   * list's `finally` depends on the rejection still arriving.
   */
  static reportQueryError(method, error, extra) {
    _logger.default.addBreadcrumb(`[ArticleService] ${method} failed`, 'article-service', {
      method,
      ...extra
    }, 'warning');
  }

  /** The server's 24h article count, or null when the query failed (a real 0 stays 0). */
  static async getRecentArticleCount() {
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_RECENT_ARTICLE_COUNT,
        fetchPolicy: 'no-cache'
      });
      return data?.recentArticleCount ?? null;
    } catch (error) {
      this.reportQueryError('getRecentArticleCount', error);
      return null;
    }
  }

  /**
   * [Flow v2] Fetch the set of article IDs matching each topic text.
   * Server checks a 30-min Redis cache first; on miss it runs vector search
   * against the last 24 hours of articles. Each topic result carries its own
   * cursor so the caller can request additional pages per topic independently.
   */
  static async getArticleIdsForTopics(topics, opts) {
    const limitPerTopic = opts?.limitPerTopic ?? 20;
    try {
      // Stay under the server's per-request topic cap. `limitPerTopic` is a
      // per-topic bound, so batching leaves its semantics unchanged. Batches
      // run sequentially to avoid stacking cold-topic vector searches.
      if (topics.length <= MAX_TOPICS_PER_BATCH) {
        return await this.queryArticleIdsBatch(topics, limitPerTopic);
      }
      const merged = [];
      const seenTopics = new Set();
      for (let i = 0; i < topics.length; i += MAX_TOPICS_PER_BATCH) {
        const batch = topics.slice(i, i + MAX_TOPICS_PER_BATCH);
        const {
          results
        } = await this.queryArticleIdsBatch(batch, limitPerTopic);
        // Preserve order; de-dup by topicText so a topic never appears twice.
        for (const result of results) {
          if (seenTopics.has(result.topicText)) continue;
          seenTopics.add(result.topicText);
          merged.push(result);
        }
      }
      return {
        results: merged
      };
    } catch (error) {
      // The apollo-error-link already captures this to Sentry; a
      // service-level captureException here would double-report (and, on a
      // retried storm, multiply). Leave a breadcrumb for context instead.
      _logger.default.addBreadcrumb('[ArticleService] getArticleIdsForTopics FAILED', 'article-service', {
        method: 'getArticleIdsForTopics',
        topicCount: topics.length
      }, 'warning');
      throw error;
    }
  }

  /**
   * [Persona v3] Fetch candidate article ids for the privacy-lean persona
   * query: topic texts + per-topic limits + COUNTRY/GLOBAL headline scopes.
   * Returns per-topic results (with matchMeta) + per-scope headline results.
   * The daily-delivery cap is NOT charged here (candidate listing is free —
   * it is charged at hydration via getArticlesForTopicsByIds).
   *
   * One request: `query.topics` must fit the server's per-request limit, so
   * feed sync sends MAX_TOPICS_PER_BATCH at a time and owns retry and resume.
   */
  static async getArticleIdsForPersona(query) {
    try {
      return await this.queryPersonaBatch(query);
    } catch (error) {
      _logger.default.addBreadcrumb('[ArticleService] getArticleIdsForPersona FAILED', 'article-service', {
        method: 'getArticleIdsForPersona',
        topicCount: query.topics.length
      }, 'warning');
      throw error;
    }
  }
  static async queryPersonaBatch(query) {
    const {
      data
    } = await _apolloClient.default.query({
      query: GET_ARTICLE_IDS_FOR_PERSONA,
      variables: {
        query
      },
      fetchPolicy: 'no-cache'
    });
    return data?.articleIdsForPersona ?? {
      topicResults: [],
      headlineResults: []
    };
  }

  /** Single-request articleIdsForTopics call (one batch of ≤ server cap topics). */
  static async queryArticleIdsBatch(topics, limitPerTopic) {
    const {
      data
    } = await _apolloClient.default.query({
      query: GET_ARTICLE_IDS_FOR_TOPICS,
      variables: {
        topics,
        limitPerTopic
      },
      fetchPolicy: 'no-cache'
    });
    return data?.articleIdsForTopics ?? {
      results: []
    };
  }

  /**
   * Fetch full article records for a set of IDs. Returns the hydrated
   * `articles` (with per-cluster membership
   * `clusters { clusterId confidence stableClusterId }` for the feed's collapse
   * logic). A server still capping downloads returns a granted prefix of each
   * chunk, so fewer articles than ids is normal. `CHUNK` is 50 because the
   * server rejects an `articlesForTopicsByIds` call carrying more than 50 ids:
   * the two limits are one contract and must move together.
   */
  static async getArticlesForTopicsByIds(articleIds, onProgress) {
    if (articleIds.length === 0) return {
      articles: []
    };
    const CHUNK = 50;
    const CONCURRENCY = 5;
    const batches = [];
    for (let i = 0; i < articleIds.length; i += CHUNK) {
      batches.push(articleIds.slice(i, i + CHUNK));
    }
    const results = [];
    let completedIds = 0;
    onProgress?.(0, articleIds.length);
    try {
      let nextIndex = 0;
      const workers = Array.from({
        length: Math.min(CONCURRENCY, batches.length)
      }, async () => {
        while (true) {
          const idx = nextIndex++;
          if (idx >= batches.length) return;
          const batch = batches[idx];
          const rows = await hydrateBatch('articlesForTopicsByIds', GET_ARTICLES_FOR_TOPICS_BY_IDS, GET_ARTICLES_FOR_TOPICS_BY_IDS_LEGACY, batch);
          if (rows.length) results.push(...rows);
          completedIds += batch.length;
          onProgress?.(completedIds, articleIds.length);
        }
      });
      await Promise.all(workers);
      return {
        articles: results
      };
    } catch (error) {
      // apollo-error-link already captures this to Sentry — breadcrumb only
      // here to avoid double- (previously triple-) reporting.
      _logger.default.addBreadcrumb('[ArticleService] getArticlesForTopicsByIds FAILED', 'article-service', {
        method: 'getArticlesForTopicsByIds',
        idCount: articleIds.length
      }, 'error');
      throw error;
    }
  }

  /**
   * Quota-EXEMPT hydration for articles that reached the device ONLY because
   * the user follows a story. Same payload as
   * {@link getArticlesForTopicsByIds}; the difference is purely billing:
   * nothing fetched here counts against a daily article cap.
   *
   * ONLY the feed-sync partition may call this. The caller must have
   * established that every topic which matched these ids is a followed-story
   * topic (see `partitionStoryIds` in feed-sync-steps) — the server cannot
   * verify that claim without persisting a user→topic link, which the privacy
   * invariant forbids, so correctness of the exemption lives here.
   *
   * CHUNK is 50 to match the server's hard per-request ceiling on this query
   * exactly (the metered sibling has no such cap — its quota is its cap).
   */
  static async getArticlesForStories(articleIds, onProgress) {
    if (articleIds.length === 0) return {
      articles: []
    };

    // Must not exceed MAX_STORY_ARTICLE_IDS_PER_REQUEST on the server (50);
    // a larger batch is rejected with BAD_USER_INPUT, not silently trimmed.
    const CHUNK = 50;
    const CONCURRENCY = 5;
    const batches = [];
    for (let i = 0; i < articleIds.length; i += CHUNK) {
      batches.push(articleIds.slice(i, i + CHUNK));
    }
    const results = [];
    let completedIds = 0;
    onProgress?.(0, articleIds.length);
    try {
      let nextIndex = 0;
      const workers = Array.from({
        length: Math.min(CONCURRENCY, batches.length)
      }, async () => {
        while (true) {
          const idx = nextIndex++;
          if (idx >= batches.length) return;
          const batch = batches[idx];
          const rows = await hydrateBatch('articlesForStories', GET_ARTICLES_FOR_STORIES, GET_ARTICLES_FOR_STORIES_LEGACY, batch);
          if (rows.length) results.push(...rows);
          completedIds += batch.length;
          onProgress?.(completedIds, articleIds.length);
        }
      });
      await Promise.all(workers);
      return {
        articles: results
      };
    } catch (error) {
      _logger.default.addBreadcrumb('[ArticleService] getArticlesForStories FAILED', 'article-service', {
        method: 'getArticlesForStories',
        idCount: articleIds.length
      }, 'error');
      throw error;
    }
  }

  /**
   * Current cluster memberships for up to {@link MAX_CLUSTER_MEMBERSHIP_IDS}
   * articles, one request. Null when this server predates the query
   * (GRAPHQL_VALIDATION_FAILED, latched for the session, nothing reported).
   * Not part of the feed sync's status: a failure never raises the banner.
   */
  static async getClusterMembershipsForArticles(articleIds) {
    if (clusterMembershipsUnsupported) return null;
    if (articleIds.length === 0) return [];
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_CLUSTER_MEMBERSHIPS_FOR_ARTICLES,
        variables: {
          articleIds: articleIds.slice(0, MAX_CLUSTER_MEMBERSHIP_IDS)
        },
        fetchPolicy: 'no-cache',
        context: {
          noSyncStatus: true,
          expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
        }
      });
      return data?.clusterMembershipsForArticles ?? [];
    } catch (error) {
      if (graphQLErrorCodes(error).includes('GRAPHQL_VALIDATION_FAILED')) {
        clusterMembershipsUnsupported = true;
        _logger.default.info('[ArticleService] server has no clusterMembershipsForArticles; no membership refresh this session');
        return null;
      }
      this.reportQueryError('getClusterMembershipsForArticles', error, {
        idCount: articleIds.length
      });
      throw error;
    }
  }

  /**
   * Fetch ONE ordered page of sibling coverage for an article.
   *
   * `after` is the previous page's `endCursor`. A response with
   * `restarted: true` means that cursor no longer resolved server-side (the
   * story was re-clustered, or the ordered list expired) and the page starts
   * from the top again — the caller must REPLACE its accumulated rows rather
   * than append, or it stacks a second copy of page 1 under what is already on
   * screen. There is no way to detect that from the rows themselves.
   */
  static async getRelatedArticlesPage(input, /** Injected for tests; production callers never pass it. */
  filtersLive = RELATED_FILTERS_LIVE) {
    const empty = {
      articles: [],
      pageInfo: {
        endCursor: null,
        hasNextPage: false,
        pageSize: 0
      },
      restarted: false,
      facets: null
    };
    try {
      // Prefer the retained stable-story id: the server maps it to the
      // current clustering generation, so the page a reader is scrolling
      // stays anchored to one story even across a re-clustering run.
      const base = {
        articleId: input.articleId,
        stableClusterId: input.stableClusterId ?? null,
        sortMode: input.sortMode ?? null,
        context: input.context ?? null,
        excludeIds: input.excludeIds ?? null,
        first: input.first ?? null,
        after: input.after ?? null
      };
      const sendFiltered = async () => {
        const variables = {
          ...base,
          countries: filterList(input.filter?.countries),
          languages: filterList(input.filter?.languages)
        };
        try {
          const {
            data
          } = await _apolloClient.default.query({
            query: GET_RELATED_ARTICLES_PAGE_FILTERED,
            variables,
            fetchPolicy: 'no-cache',
            context: {
              expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
            }
          });
          return data?.relatedArticlesPage ? {
            ...data.relatedArticlesPage,
            facets: data.relatedArticlesPage.facets ?? null
          } : empty;
        } catch (error) {
          if (!graphQLErrorCodes(error).includes('GRAPHQL_VALIDATION_FAILED')) throw error;
          relatedFiltersUnsupported = true;
          _logger.default.info('[ArticleService] server has no related filters or facets; default related document this session');
          return null;
        }
      };
      if (filtersLive && !relatedFiltersUnsupported) {
        const filtered = await sendFiltered();
        if (filtered) return filtered;
      }
      {
        const page = data => data?.relatedArticlesPage ? {
          ...data.relatedArticlesPage,
          facets: null
        } : empty;
        if (!relatedOriginalUnsupported) {
          try {
            const {
              data
            } = await _apolloClient.default.query({
              query: GET_RELATED_ARTICLES_PAGE,
              variables: base,
              fetchPolicy: 'no-cache',
              context: {
                expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
              }
            });
            return page(data);
          } catch (error) {
            if (!graphQLErrorCodes(error).includes('GRAPHQL_VALIDATION_FAILED')) throw error;
            relatedOriginalUnsupported = true;
            _logger.default.info('[ArticleService] server has no ArticleSummary.title_original; legacy related document this session');
          }
        }
        const {
          data
        } = await _apolloClient.default.query({
          query: GET_RELATED_ARTICLES_PAGE_LEGACY,
          variables: base,
          fetchPolicy: 'no-cache'
        });
        return page(data);
      }
    } catch (error) {
      this.reportQueryError('getRelatedArticlesPage', error, {
        articleId: input.articleId,
        stableClusterId: input.stableClusterId
      });
      throw error;
    }
  }

  /**
   * Fetch a single article by ID. Returns null if the server has TTL'd it
   * out or the ID is unknown — the caller treats that as the not-found
   * state.
   */
  static async getArticleById(articleId) {
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_ARTICLE_BY_ID,
        variables: {
          id: articleId
        },
        fetchPolicy: 'no-cache'
      });
      return data?.articleById ?? null;
    } catch (error) {
      this.reportQueryError('getArticleById', error, {
        articleId
      });
      throw error;
    }
  }

  /**
   * Get articles for a cluster, optionally excluding specific article IDs
   */
  /**
   * Get a country's "top headlines" with pagination — last-24h articles
   * across all the country's sources, sorted by largest cluster size on the
   * server. Pass 'GLOBAL' (or omit) for all countries.
   */
  static async getArticlesForCountry(countryCode, options) {
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_ARTICLES_FOR_COUNTRY,
        variables: {
          countryCode: countryCode === 'GLOBAL' ? null : countryCode,
          first: options?.first ?? 20,
          after: options?.after
        },
        fetchPolicy: 'no-cache'
      });
      return data?.articlesForCountry || {
        articles: [],
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
          pageSize: options?.first ?? 20
        }
      };
    } catch (error) {
      this.reportQueryError('getArticlesForCountry', error, {
        countryCode
      });
      throw error;
    }
  }

  /**
   * Get a country's precomputed, cluster-deduplicated "top headlines" with
   * pagination — each big story appears once, ranked over the materialized
   * edition. Pass 'GLOBAL' (or omit) for all countries. `editionBuiltAt` is
   * null when no edition exists yet (server fell back to the live path).
   */
  static async getTopHeadlinesForCountry(countryCode, options) {
    try {
      const variables = {
        countryCode: countryCode === 'GLOBAL' ? null : countryCode,
        first: options?.first ?? 20,
        after: options?.after
      };
      if (options?.windowHours !== undefined && !exploreWindowUnsupported) {
        try {
          const {
            data
          } = await _apolloClient.default.query({
            query: GET_TOP_HEADLINES_FOR_COUNTRY_WINDOWED,
            variables: {
              ...variables,
              windowHours: options.windowHours
            },
            fetchPolicy: 'no-cache',
            context: {
              expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED', 'BAD_WINDOW']
            }
          });
          if (data?.topHeadlinesForCountry) return data.topHeadlinesForCountry;
        } catch (error) {
          const codes = graphQLErrorCodes(error);
          // BAD_WINDOW: a server from before the 6h/12h views. That
          // one request gets the plain (24h) document; no latch, so
          // the other windows keep working.
          if (codes.includes('BAD_WINDOW')) {
            _logger.default.info('[ArticleService] server refused this Explore window; plain document');
          } else {
            if (!codes.includes('GRAPHQL_VALIDATION_FAILED')) throw error;
            exploreWindowUnsupported = true;
            _logger.default.info('[ArticleService] server has no topHeadlinesForCountry windowHours; plain document this session');
          }
        }
      }
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_TOP_HEADLINES_FOR_COUNTRY,
        variables,
        fetchPolicy: 'no-cache'
      });
      return data?.topHeadlinesForCountry || {
        articles: [],
        headlines: [],
        editionBuiltAt: null,
        pageInfo: {
          endCursor: null,
          hasNextPage: false,
          pageSize: options?.first ?? 20
        }
      };
    } catch (error) {
      this.reportQueryError('getTopHeadlinesForCountry', error, {
        countryCode
      });
      throw error;
    }
  }

  /** Level-1 canonical topics, fetched once per app session. [] on a server without them. */
  static getCanonicalTopics() {
    if (worldTopicsUnsupported) return Promise.resolve([]);
    if (!canonicalTopicsCache) {
      const pending = _apolloClient.default.query({
        query: GET_CANONICAL_TOPICS,
        variables: {
          level: 1
        },
        fetchPolicy: 'no-cache',
        context: {
          expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
        }
      }).then(({
        data
      }) => data?.canonicalTopics ?? []).catch(error => {
        canonicalTopicsCache = null; // retry next time
        if (!graphQLErrorCodes(error).includes('GRAPHQL_VALIDATION_FAILED')) {
          this.reportQueryError('getCanonicalTopics', error, {});
          throw error;
        }
        worldTopicsUnsupported = true;
        return [];
      });
      canonicalTopicsCache = pending;
    }
    return canonicalTopicsCache;
  }

  /**
   * A World / country headlines page with topic facets. `canonicalTopicIds`
   * filters; facets always count the unfiltered page+window. A server without
   * `worldHeadlines` answers GRAPHQL_VALIDATION_FAILED: latched for the
   * session, and the list comes from the current windowed country document
   * with `topicsSupported: false` and no facets, so the list keeps working.
   */
  static async getWorldHeadlines(countryCode, options) {
    if (!worldTopicsUnsupported) {
      try {
        const {
          data
        } = await _apolloClient.default.query({
          query: GET_WORLD_HEADLINES,
          variables: {
            countryCode: countryCode === 'GLOBAL' ? null : countryCode,
            first: options.first ?? 20,
            after: options.after,
            windowHours: options.windowHours,
            canonicalTopicIds: options.canonicalTopicIds?.length ? options.canonicalTopicIds : undefined
          },
          fetchPolicy: 'no-cache',
          context: {
            expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
          }
        });
        if (data?.worldHeadlines) return {
          ...data.worldHeadlines,
          topicsSupported: true
        };
      } catch (error) {
        if (!graphQLErrorCodes(error).includes('GRAPHQL_VALIDATION_FAILED')) {
          this.reportQueryError('getWorldHeadlines', error, {
            countryCode
          });
          throw error;
        }
        worldTopicsUnsupported = true;
        _logger.default.info('[ArticleService] server has no worldHeadlines; country document this session');
      }
    }
    const page = await this.getTopHeadlinesForCountry(countryCode, options);
    return {
      headlines: page.headlines,
      pageInfo: page.pageInfo,
      editionBuiltAt: page.editionBuiltAt,
      facets: [],
      topicsSupported: false
    };
  }

  /**
   * One page of a publisher's articles across all its feeds.
   *
   * `order` NEWEST is the full 48h newest first; TOP_HEADLINES (the server
   * default) is the last 24h ranked by cluster size. Without `order` the
   * server default applies.
   *
   * A server that predates `order` rejects the whole document
   * (GRAPHQL_VALIDATION_FAILED, before any resolver runs, so nothing is
   * charged). The first such answer marks the argument unsupported for the
   * session and the same page is asked for once without it;
   * `orderApplied: false` then tells the caller it got top headlines.
   */
  static async getArticlesForPublisher(newsPublisherId, options) {
    const first = options?.first ?? 20;
    const empty = {
      articles: [],
      pageInfo: {
        endCursor: null,
        hasNextPage: false,
        pageSize: first
      }
    };
    const base = {
      newsPublisherId,
      first,
      after: options?.after
    };
    const withOrder = options?.order !== undefined && !publisherOrderUnsupported;
    try {
      if (withOrder) {
        try {
          const {
            data
          } = await _apolloClient.default.query({
            query: GET_ARTICLES_FOR_PUBLISHER,
            variables: {
              ...base,
              order: options?.order
            },
            fetchPolicy: 'no-cache',
            context: {
              expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
            }
          });
          return {
            ...(data?.articlesForPublisher || empty),
            orderApplied: true
          };
        } catch (error) {
          if (!graphQLErrorCodes(error).includes('GRAPHQL_VALIDATION_FAILED')) throw error;
          publisherOrderUnsupported = true;
          _logger.default.info('[ArticleService] server has no articlesForPublisher order; top headlines this session');
        }
      }
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_ARTICLES_FOR_PUBLISHER_NO_ORDER,
        variables: base,
        fetchPolicy: 'no-cache'
      });
      return {
        ...(data?.articlesForPublisher || empty),
        // Without `order` the server answers top headlines.
        orderApplied: options?.order === undefined || options.order === 'TOP_HEADLINES'
      };
    } catch (error) {
      // No publisher id in the crumb: which publication a reader opens
      // is reading history.
      this.reportQueryError('getArticlesForPublisher', error);
      throw error;
    }
  }

  /**
   * Get the live cluster an article currently belongs to (via its newest
   * cluster-article-link). Returns null when the article is unclustered or
   * its cluster has aged out. Used as the live fallback when a story isn't
   * archived (trackStory/getTrackedStory returned null).
   */
  static async getNewsClusterForArticle(articleId, options) {
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_NEWS_CLUSTER_FOR_ARTICLE,
        variables: {
          articleId,
          first: options?.first ?? 10,
          after: options?.after
        },
        fetchPolicy: 'no-cache'
      });
      return data?.newsClusterForArticle ?? null;
    } catch (error) {
      this.reportQueryError('getNewsClusterForArticle', error, {
        articleId
      });
      throw error;
    }
  }
}
exports.ArticleService = ArticleService;
var _default = exports.default = ArticleService;