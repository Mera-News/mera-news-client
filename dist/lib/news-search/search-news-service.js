"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SEARCH_NEWS_MIN_QUERY_LENGTH = exports.SEARCH_NEWS_MAX_RESULTS = void 0;
exports.searchNews = searchNews;
var _client = require("@apollo/client");
var _apolloClient = _interopRequireDefault(require("../platform/apollo-client"));
var _logger = _interopRequireDefault(require("../logger"));
var _notSubscribedError = require("../subscription/not-subscribed-error");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// search-news-service — thin GraphQL wrapper around the server's `searchNews`
// query for the full-screen Search route.
//
// `searchNews` is deliberately headline-only (no description, no article_url —
// see the schema comment on `NewsSearchHit`): with no scraped article body in
// this product, title + description IS the article, so returning it unmetered
// would be a paywall bypass. Callers render from exactly what this returns —
// there is no follow-up hydration call to make here.
//
// It is AUTHENTICATED but NOT subscription-gated. It used to carry
// `SubscriptionGuard`; the server removed it deliberately, because search is a
// discovery surface a Mera News Free reader must be able to use — the same
// reader can already browse Explore and open an article. See the reasoning on
// `NewsSearchResolver.searchNews`.
//
// The `'not-subscribed'` branch below is therefore UNREACHABLE today. It is kept
// rather than deleted so that re-adding the guard server-side cannot produce a
// generic "something went wrong" on a paywall, but do not treat its existence
// as evidence that search is gated.
//
// The server is also HYBRID now, not semantic-only: an Atlas Search text leg
// fused with the vector leg by reciprocal rank. Each leg degrades on its own, so
// a provider or index outage shows up as weaker results rather than an error.
//
// Never throws: every failure — network, GraphQL, auth — resolves to
// `{ ok: false, kind }` so callers never need a try/catch of their own.

/**
 * Client-side floor. This is OURS, not the server's — `searchNews` rejects only
 * an empty query. It exists so a single character does not spend a round trip
 * (and, on a cache miss, a paid embedding call) on a query that cannot be
 * meaningful. Enforced twice on purpose: here, and in `useNewsSearch` so the
 * panel clears the instant the user deletes back below it.
 */
const SEARCH_NEWS_MIN_QUERY_LENGTH = exports.SEARCH_NEWS_MIN_QUERY_LENGTH = 2;

/** Server-side cap on `searchNews` results (see schema.gql / server resolver). */
const SEARCH_NEWS_MAX_RESULTS = exports.SEARCH_NEWS_MAX_RESULTS = 25;
const SEARCH_NEWS = (0, _client.gql)`
  query SearchNews($query: String!, $limit: Int) {
    searchNews(query: $query, limit: $limit) {
      _id
      title_en
      image_url
      publication_name
      country_code
      pubDate
      score
    }
  }
`;
/**
 * Run the search. `query` is trimmed here as well as by callers — a query that
 * trims below `SEARCH_NEWS_MIN_QUERY_LENGTH` resolves to an empty success
 * rather than round-tripping to a server that would reject it anyway.
 */
async function searchNews(query, limit = SEARCH_NEWS_MAX_RESULTS) {
  const trimmed = query.trim();
  if (trimmed.length < SEARCH_NEWS_MIN_QUERY_LENGTH) {
    return {
      ok: true,
      hits: []
    };
  }
  try {
    const {
      data
    } = await _apolloClient.default.query({
      query: SEARCH_NEWS,
      variables: {
        query: trimmed,
        limit
      },
      fetchPolicy: 'no-cache'
    });
    return {
      ok: true,
      hits: data?.searchNews ?? []
    };
  } catch (error) {
    const kind = (0, _notSubscribedError.isNotSubscribedError)(error) ? 'not-subscribed' : 'unknown';
    // A 402 here is Mera News Free working as designed, same as the other
    // guarded AI queries — a breadcrumb is enough, not a Sentry exception.
    if (kind === 'not-subscribed') {
      _logger.default.addBreadcrumb('[news-search-service] searchNews NOT_SUBSCRIBED', 'news-search', {
        queryLength: trimmed.length
      }, 'warning');
    } else {
      _logger.default.captureException(error, {
        tags: {
          service: 'news-search-service',
          method: 'searchNews'
        },
        extra: {
          queryLength: trimmed.length
        }
      });
    }
    return {
      ok: false,
      kind
    };
  }
}