"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TOPIC_FETCH_BUDGET_MS = exports.TOPIC_CURSOR_KEY = exports.HYDRATE_STOP_AFTER_MS = exports.HYDRATE_CONCURRENCY = exports.HYDRATE_CHUNK_SIZE = exports.CLUSTER_MEMBERSHIP_REFRESH_KEY = exports.CLUSTER_MEMBERSHIP_REFRESH_EVERY_MS = exports.CLUSTER_MEMBERSHIP_MAX_AGE_MS = exports.BG_TOPIC_FETCH_BUDGET_MS = void 0;
exports.computeFreeTopicTexts = computeFreeTopicTexts;
exports.growTrackedStories = growTrackedStories;
exports.partitionStoryIds = partitionStoryIds;
exports.splitAlreadyReadArticles = splitAlreadyReadArticles;
exports.stepDiff = stepDiff;
exports.stepFetchTopicIds = stepFetchTopicIds;
exports.stepHydratePersistEnqueue = stepHydratePersistEnqueue;
exports.stepRefreshClusterMemberships = stepRefreshClusterMemberships;
exports.stepScore = stepScore;
var _articleService = require("../../article-service");
var _articleSuggestionScoringWrites = require("../../database/services/article-suggestion-scoring-writes");
var _articleSuggestionReads = require("../../database/services/article-suggestion-reads");
var _articleSuggestionPersist = require("../../database/services/article-suggestion-persist");
var _factService = require("../../database/services/fact-service");
var _settingService = require("../../database/services/setting-service");
var _topicService = require("../../database/services/topic-service");
var _personaMigrationService = require("../../services/persona-migration-service");
var _locationService = require("../../database/services/location-service");
var _headlineDepthService = require("../../database/services/headline-depth-service");
var _retrievalProfile = require("../../news-harness/scoring-engine/retrieval-profile");
var _scoring = require("../../news-harness/article-pipeline/scoring");
var _graphqlTypes = require("../../generated/graphql-types");
var _scorePropagation = require("../../feed-grouping/score-propagation");
var _readStoryFilter = require("../../feed-grouping/read-story-filter");
var _userGeoLanguageContext = require("../../user-context/user-geo-language-context");
var _logger = _interopRequireDefault(require("../../logger"));
var _meraProtocolStore = require("../../stores/mera-protocol-store");
var _factRowsSelector = require("../../stores/fact-rows-selector");
var coldstartTimeline = _interopRequireWildcard(require("../../diagnostics/coldstart-timeline"));
var _retry = require("../../utils/retry");
var _idle = require("../idle");
var _trackedStoryReconcile = require("./tracked-story-reconcile");
var _trackActions = require("../../tracking/track-actions");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; } // Individual steps of the feed sync flow, extracted from SuggestionSyncService.
// Each step is a pure async function that can be aborted via AbortSignal.
// The ONE admission predicate ("may this row enter scoring"), shared with the
// enqueue path and the bundle builders so a headline cannot be admitted by one
// and dropped by another.
/**
 * Retries for the ArticleService calls below. ONE, not three, and not zero.
 *
 * Every call here goes out through Apollo, and Apollo's RetryLink already makes
 * up to 3 jittered HTTP attempts on a transport failure. Stacking withRetry's
 * default 3 on top of that made one failing step 4 x 3 = 12 attempts, and the
 * scheduler's own 3 job attempts took it to 36.
 *
 * It is not 0, though, because RetryLink CANNOT see the failure that matters
 * most here: an HTTP 200 carrying an `errors[]` array. RetryLink fires only
 * from the observable's error channel, and a GraphQL-level error (a resolver
 * timeout, an overloaded news-graphql returning INTERNAL_SERVER_ERROR) is
 * delivered through `next` and turned into a rejection above the link chain.
 * This single retry is the only cover for that class.
 *
 * So the layers are no longer three copies of one idea: Apollo owns transport,
 * this owns resolver errors, the scheduler owns the cycle. Worst case per
 * failing step is now 2 x 3 x 3 = 18.
 *
 * Do not "simplify" this to 0 as redundant with Apollo. It is not.
 */
const RESOLVER_ERROR_RETRIES = 1;
/** Number of missing ids hydrated + persisted + enqueued per iteration. Kept at
 *  25 so each `getArticlesForTopicsByIds` call is a single server query (its
 *  internal chunk size is 50) and each enqueued batch is exactly one scoring
 *  batch (`BATCH_SIZE = 25` in scoring-pipeline). */
const HYDRATE_CHUNK_SIZE = exports.HYDRATE_CHUNK_SIZE = 25;

/** Hydrate up to this many chunks concurrently. WatermelonDB
 *  serializes writes internally, so per-chunk persists are safe to interleave;
 *  the gate+enqueue step is separately serialized behind a promise chain. */
const HYDRATE_CONCURRENCY = exports.HYDRATE_CONCURRENCY = 3;

/**
 * Hard-filter reconcile for the gate's propagation half. Propagated rows are
 * written terminal `complete` with a donor's relevance and never enter
 * computeMathStage/computeAndScore — which is where `screenHardSuppressions`
 * runs — so without this a "Blocked" article can inherit a passing score and
 * render, defeating the badge's "never show me these at all" promise.
 *
 * This is the FULL sweep, not the scoped `purgeHardFilteredByIds`, because
 * `GateResult` reports a count and not the ids it wrote (see the HARD FILTERS
 * note in score-propagation.ts, which also explains why the chunk's own ids are
 * not a valid substitute). Cost is bounded the right way: the sweep returns
 * after a single persona read for any user with no hard filters — the common
 * case — and only pays for the row scan when filters actually exist.
 *
 * Lazy `require`, mirroring persona-mutation-sweeps::runSweep for the same
 * documented reason: module-graph weight. A static import drags stage-scoring →
 * llm/completeLocal → the native DB singleton into this module.
 */
const reconcileHardFilters = async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sweep = require("../../services/suppression-sweep");
  await sweep.purgeHardFilteredSuggestions();
};

/**
 * Convergence sweep for the LOW-band top-headline cull. The scoring paths cull
 * at score-persist time; this catches the two classes of row that never reach
 * that gate:
 *
 *   1. BACKFILL — LOW headlines persisted before the cull shipped are already
 *      on device and live out the full 48h TTL.
 *   2. PROPAGATION — `propagateToUnscoredSiblings` stamps a donor's relevance
 *      onto a headline sibling as terminal `complete` without ever entering the
 *      scoring stage, so a LOW donor score arrives pre-culled.
 *
 * Called ONCE per hydrate step, at the gate-drain point — not inside
 * `gateAndEnqueue`'s `propagatedCount > 0` branch, where the existing
 * `reconcileHardFilters` sits. That branch runs per CHUNK and only when
 * something propagated, so it would both repeat the sweep needlessly and skip
 * the backfill half entirely on a sync that propagated nothing. After the chain
 * drains, every propagation write of this run is committed.
 *
 * Not reached on a sync that found no new articles — FeedSyncMachine
 * short-circuits to `scoring` before this step. Harmless: that path can produce
 * no propagation leak (nothing propagated), and the backfill it defers is
 * deleted outright at the 48h TTL anyway.
 */
const cullLowHeadlines = async () => {
  const ids = await (0, _articleSuggestionReads.getCullableLowHeadlineIds)();
  if (ids.length === 0) return;
  await (0, _articleSuggestionScoringWrites.batchMarkExcluded)(ids);
  // Unlike the persist-time culls (which fire before a row was ever visible),
  // rows reached here were `complete` and may already be laid out in the
  // persisted feed order — evict them the same filter-scoped way the
  // suppression sweep does: exactly these ids, nothing inferred.
  const {
    useFeedOrderStore
  } = require("../../stores/feed-order-store");
  useFeedOrderStore.getState().removeIds(ids);
  _logger.default.info(`[feed-sync-steps] culled ${ids.length} LOW-band headline rows`);
};

/**
 * ALREADY-READ SCREEN, cheapest apply point. A server-returned
 * article that re-serves a story the user already TAPPED OPEN is never persisted
 * at all: no suggestion row, no scoring pass, nothing to render or evict later.
 * The matching rules (article_id ∪ normalized-title Jaccard ≥ 0.55) and the
 * measurements behind them live in `lib/feed-grouping/read-story-filter.ts`.
 */
function articleReadCandidate(a) {
  return {
    articleId: a._id,
    title: a.title_en ?? a.title ?? null
  };
}

/**
 * Split a hydrated chunk into "persist these" and "the user already read these".
 * Pure. Returns the input array identity when the index is inert so the common
 * (no reads recorded) case allocates nothing.
 */
function splitAlreadyReadArticles(articles, index) {
  if (index.impressionCount === 0) return {
    toPersist: articles,
    readCount: 0
  };
  const toPersist = [];
  let readCount = 0;
  for (const a of articles) {
    if ((0, _readStoryFilter.matchesReadStory)(articleReadCandidate(a), index)) readCount += 1;else toPersist.push(a);
  }
  return {
    toPersist,
    readCount
  };
}

/** Settings row: the NORMALIZED text of the first topic the last foreground sync
 *  did not fetch. Absent when that pass reached the end of the list. Local to the
 *  device and not on the backup allowlist. */
const TOPIC_CURSOR_KEY = exports.TOPIC_CURSOR_KEY = 'feed_sync_topic_cursor';

/** How long the id fetch may launch batches: half the 3-minute `feed-sync` job,
 *  so hydrate and scoring still get the other half. */
const TOPIC_FETCH_BUDGET_MS = exports.TOPIC_FETCH_BUDGET_MS = 90_000;

/** The same for the OS task, whose whole run has 60s. */
const BG_TOPIC_FETCH_BUDGET_MS = exports.BG_TOPIC_FETCH_BUDGET_MS = 20_000;

/** How far into a foreground run hydrate may launch chunks. Past it the rest stay
 *  new-to-device for a later sync, ahead of the job's 3-minute abort. */
const HYDRATE_STOP_AFTER_MS = exports.HYDRATE_STOP_AFTER_MS = 150_000;

/** Result of the merged hydrate + persist + enqueue step. */

async function stepFetchTopicIds(_userPersonaId, ctx, opts = {}) {
  if (ctx.signal.aborted) throw (0, _retry.createCancellationError)();

  // Run the (flag-guarded, instant no-op after first completion) topic migration first, so a device
  // that has not migrated yet has its topic rows before they are read. A migration failure must never
  // kill the sync: it goes on with whatever topics exist.
  try {
    await (0, _personaMigrationService.runPersonaMigrationIfNeeded)();
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        component: 'feed-sync-steps',
        method: 'runPersonaMigrationIfNeeded'
      }
    });
  }

  // With no active topic (a fact whose topics are not made yet, a place with no fact, or every topic
  // staged for deletion), the persona query still brings the country and the world. Only no fact and
  // no place at all is terminal.
  const activeTopics = await (0, _topicService.getActive)();
  if (activeTopics.length === 0 && !(await (0, _factService.hasAnyFacts)()) && (await (0, _locationService.getAll)()).length === 0) {
    throw Object.assign(new Error('no-topics-configured'), {
      code: 'no-topics-configured'
    });
  }
  return fetchTopicIdsPersona(activeTopics, ctx, opts.background ?? false);
}

/**
 * Normalized texts that may be hydrated QUOTA-FREE: the texts carried by
 * `provenance: 'tracked'` topics, MINUS every text carried by any other active
 * topic. Following a story must not consume the user's daily article
 * allowance — but only articles that arrived *solely* because of a followed
 * story qualify.
 *
 * WHY A SET DIFFERENCE AND NOT A MEMBERSHIP TEST. Two active topic rows can
 * legitimately carry the same text. `createTopics` dedupes on
 * `(normalized_text, fact_id)` — deliberately NOT on text alone, so that the
 * hygiene `duplicate_facts` detector can still see one text owned by two facts.
 * So a tracked topic ("gaza ceasefire", fact_id null) and an interest topic
 * ("Gaza ceasefire", owned by a fact) coexist by design. A plain
 * `trackedTexts.has(t)` would then hand every article matched by the INTEREST
 * free hydration too.
 *
 * WHY NOT PARTITION ON topicId. The obvious instinct — use ids, not strings —
 * does not work: the server keys its response by topic TEXT, so attributing a
 * returned id back to a row means going through `textToTopicId`, which is
 * first-writer-wins over duplicate texts. The id would be an arbitrary one of
 * the colliding rows, whose provenance may be the wrong one. The set difference
 * sidesteps id attribution entirely.
 *
 * Comparison is on NORMALIZED text so case/whitespace variants ("Gaza Ceasefire"
 * vs "gaza ceasefire") collapse onto the metered side rather than slipping past
 * the subtraction.
 *
 * Direction of failure is deliberate: a collision makes a followed story's
 * articles METERED (the status quo before this change), never the reverse. The
 * exemption can under-apply; it can never over-apply.
 */
function computeFreeTopicTexts(activeTopics) {
  const tracked = new Set();
  const nonTracked = new Set();
  for (const t of activeTopics) {
    const key = (0, _topicService.normalizeTopicText)(t.text ?? '');
    if (!key) continue;
    (t.provenance === 'tracked' ? tracked : nonTracked).add(key);
  }
  for (const key of nonTracked) tracked.delete(key);
  return tracked;
}

/**
 * Split new-to-device ids into the quota-EXEMPT (followed-story) set and the
 * METERED set.
 *
 * An id is free ONLY if every topic text that matched it is a free text, and it
 * did not also arrive via a headline scope (top-headline injection is ordinary
 * feed delivery and stays metered — mirroring the first-writer precedence the
 * headline pass already applies to `headlineScope`).
 *
 * METERED WINS on any overlap. An article matched by both a followed story and
 * a real interest is content the user would have received anyway.
 *
 * The two outputs are disjoint by construction, and their union is exactly the
 * input — the caller has already applied the new-to-device filter ONCE, and
 * this must not re-filter or drop anything.
 */
function partitionStoryIds(missingIds, articleToTopicTexts, freeTopicTexts, headlineScope) {
  if (!freeTopicTexts || freeTopicTexts.size === 0) {
    return {
      storyIds: [],
      personaIds: missingIds
    };
  }
  const storyIds = [];
  const personaIds = [];
  for (const id of missingIds) {
    const texts = articleToTopicTexts.get(id) ?? [];
    const free = texts.length > 0 && !headlineScope?.has(id) && texts.every(t => freeTopicTexts.has((0, _topicService.normalizeTopicText)(t)));
    (free ? storyIds : personaIds).push(id);
  }
  return {
    storyIds,
    personaIds
  };
}

/**
 * Ask for `query.topics` one batch at a time, each with its own retry, so a failed
 * batch costs only itself. Stops at the time budget or at a batch that stays down
 * and returns what arrived. The foreground run records the first topic not fetched
 * and the next sync starts there; the sync after a finished pass starts at the top,
 * so a topic the order moved past a cursor waits one pass at most.
 *
 * A background run always starts at the top and leaves the cursor alone: it serves
 * followed stories first, and a foreground pass is the one that owes the whole list.
 */
async function fetchPersonaBatches(query, ctx, background) {
  const startedAt = Date.now();
  const budgetMs = background ? BG_TOPIC_FETCH_BUDGET_MS : TOPIC_FETCH_BUDGET_MS;
  // A lost cursor costs a repeat of the pass, never the sync.
  const cursor = background ? null : await (0, _settingService.getSetting)(TOPIC_CURSOR_KEY).catch(err => {
    _logger.default.warn('[feed-sync-steps] topic cursor unreadable', err);
    return null;
  });
  const saveCursor = write => write().catch(err => _logger.default.warn('[feed-sync-steps] topic cursor not saved', err));
  const start = cursor ? Math.max(0, query.topics.findIndex(t => (0, _topicService.normalizeTopicText)(t.text) === cursor)) : 0;
  const topicResults = [];
  const headlineResults = [];
  let at = start;
  do {
    if (at > start && Date.now() - startedAt >= budgetMs) break;
    const batch = {
      ...query,
      topics: query.topics.slice(at, at + _articleService.MAX_TOPICS_PER_BATCH),
      // Query-level, not per-topic: repeating them would multiply the headline
      // results. Every sync's first batch, a resumed one's too.
      topHeadlines: at === start ? query.topHeadlines : undefined
    };
    try {
      const res = await (0, _retry.withRetry)(() => _articleService.ArticleService.getArticleIdsForPersona(batch), ctx.signal, RESOLVER_ERROR_RETRIES);
      topicResults.push(...res.topicResults);
      headlineResults.push(...res.headlineResults);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      if (at === start) {
        // Going back to the top keeps one bad batch from holding the headlines.
        if (cursor) await saveCursor(() => (0, _settingService.deleteSetting)(TOPIC_CURSOR_KEY));
        throw err;
      }
      ctx.log(`topic batch at ${at} failed, keeping the ${at - start} topics that arrived`);
      break;
    }
    at += _articleService.MAX_TOPICS_PER_BATCH;
  } while (at < query.topics.length);
  if (!background) {
    const next = query.topics[at];
    if (next) {
      ctx.log(`topic fetch stopped at ${at} of ${query.topics.length}`);
      await saveCursor(() => (0, _settingService.setSetting)(TOPIC_CURSOR_KEY, (0, _topicService.normalizeTopicText)(next.text)));
    } else if (cursor) {
      await saveCursor(() => (0, _settingService.deleteSetting)(TOPIC_CURSOR_KEY));
    }
  }
  return {
    topicResults,
    headlineResults
  };
}

/** Persona-v3 privacy-lean retrieval: build the retrieval profile from weighted
 *  topics + locations, call articleIdsForPersona, and invert the per-topic
 *  matchMeta + headline results into the persist metadata. */
async function fetchTopicIdsPersona(activeTopics, ctx, background = false) {
  const [factWeights, locations, headlineDepths] = await Promise.all([(0, _articleSuggestionReads.getFactWeightById)(), (0, _locationService.getAll)(),
  // Per-scope depth is a personalization nicety; a read failure must degrade
  // to the shipped default rather than wedge the whole feed sync (absence
  // already means "use the default" everywhere downstream).
  (0, _headlineDepthService.getHeadlineDepths)().catch(err => {
    _logger.default.warn('[feed-sync-steps] headline depths unreadable — using defaults', err);
    return {};
  })]);
  const profile = (0, _retrievalProfile.buildRetrievalProfile)({
    topics: activeTopics.map(t => ({
      topicId: t.id,
      text: t.text,
      weight: t.weight,
      highPriority: t.highPriority,
      factWeight: t.factId ? factWeights.get(t.factId) ?? 1 : 1,
      factId: t.factId,
      createdAtMs: t.createdAt instanceof Date ? t.createdAt.getTime() : 0
    })),
    locations: locations.map(l => ({
      countryCode: l.countryCode,
      role: l.role,
      weight: l.weight,
      validUntilMs: l.validUntil ?? undefined
    })),
    // Absence-means-default: only scopes the reader actually overrode appear
    // here, and buildRetrievalProfile emits a `limit` only where the override
    // differs from the request-level default — so an untouched profile still
    // sends the byte-identical payload it sent before per-scope depth existed.
    headlineDepthByScope: headlineDepths
  });

  // There may be no topic with a positive effective weight (none made yet, all muted, or the last one
  // staged for delete). The request still goes out with no topics: the headline scopes are always
  // present, so the reader gets headlines.

  const textToTopicId = new Map();
  for (const t of profile.topics) {
    if (!textToTopicId.has(t.text)) textToTopicId.set(t.text, t.topicId);
  }

  // ONE set, two consumers: the per-topic `strictMatch` flag on the wire below,
  // and the billing partition returned at the bottom of this function. Deriving
  // "tracked-only" twice is exactly how the two would drift, and they must
  // agree — an article hydrated free because a followed story was its only
  // match is the same article that story asked the server to match strictly.
  const freeTopicTexts = computeFreeTopicTexts(activeTopics);

  // Followed topics lead, so a sync that runs short has served them. Any tracked
  // row counts, a text shared with a fact included.
  const followedTexts = new Set(activeTopics.filter(t => t.provenance === 'tracked').map(t => (0, _topicService.normalizeTopicText)(t.text)));
  const isFollowed = t => followedTexts.has((0, _topicService.normalizeTopicText)(t.text));
  const requestOrder = [...profile.topics.filter(isFollowed), ...profile.topics.filter(t => !isFollowed(t))];
  const query = {
    topics: requestOrder.map(t => {
      // Written as a typed variable + conditional assignment, NOT a conditional
      // spread. A spread bypasses excess-property checking, so a typo'd key
      // would compile — and an input field the server does not know fails the
      // WHOLE articleIdsForPersona query, i.e. feed sync stops for everyone who
      // follows a story. This shape makes that a compile error instead.
      const topic = {
        text: t.text,
        limit: t.limit
      };

      // Tighten the server's match floor for followed stories ONLY.
      //
      // Keyed on NORMALIZED text, not topicId, for the same reason the billing
      // partition is (see computeFreeTopicTexts): the server answers keyed by
      // topic TEXT. A tracked topic and a fact-owned interest topic can
      // legitimately carry the same text; buildRetrievalProfile collapses such
      // normalised duplicates into ONE entry, and
      // computeFreeTopicTexts, over ALL active topics, guarantees the flag is
      // absent whenever any non-tracked topic shares the text. LOOSE always
      // wins a collision: tightening a followed story must never quietly
      // tighten an ordinary interest's feed.
      //
      // OMITTED, not false, when not tracked-only — the same absence-is-default
      // rule the headline scopes follow just below, so a reader who follows no
      // stories sends the byte-identical payload they send today.
      if (freeTopicTexts.has((0, _topicService.normalizeTopicText)(t.text))) topic.strictMatch = true;
      return topic;
    }),
    // Query-level fallback only: the server prefers each topic's own `limit`
    // (set by buildRetrievalProfile, which now tops out at 40) and only falls
    // back to this when a topic omits one. Kept in step with that ceiling so
    // the two can't disagree — a larger value here was simply dead.
    limitPerTopic: 40,
    topHeadlines: {
      scopes: profile.headlineScopes.map(s => ({
        scope: s.scope === 'COUNTRY' ? _graphqlTypes.HeadlineScope.Country : _graphqlTypes.HeadlineScope.Global,
        countryCode: s.countryCode ?? null,
        // OMITTED, not null, when this scope uses the request-level default.
        // buildRetrievalProfile only sets `limit` where an override actually
        // differs, and sending an explicit null on every scope would change
        // every user's payload for no behavioural gain.
        ...(s.limit === undefined ? {} : {
          limit: s.limit
        })
      })),
      limitPerScope: profile.headlineLimitPerScope
    }
  };
  ctx.log(`fetching persona ids for ${profile.topics.length} topics + ${profile.headlineScopes.length} scopes`);
  _logger.default.debug(`[feed-sync-steps] calling articleIdsForPersona: ${profile.topics.length} topics, ${profile.headlineScopes.length} headline scopes`);
  const res = await fetchPersonaBatches(query, ctx, background);
  const articleToTopicTexts = new Map();
  const matchedTopics = new Map();
  const headlineScope = new Map();
  const headlineCountryCode = new Map();
  const stableClusterId = new Map();
  const pushMatched = (articleId, entry) => {
    const bucket = matchedTopics.get(articleId) ?? [];
    bucket.push(entry);
    matchedTopics.set(articleId, bucket);
    const texts = articleToTopicTexts.get(articleId) ?? [];
    if (entry.text && !texts.includes(entry.text)) texts.push(entry.text);
    articleToTopicTexts.set(articleId, texts);
  };

  // Invert per-topic results → per-article matched topics.
  for (const tr of res.topicResults ?? []) {
    if (freeTopicTexts.has((0, _topicService.normalizeTopicText)(tr.topicText))) {
      ctx.log(`followed story "${tr.topicText}": server returned ${tr.articleIds?.length ?? 0} ids`);
    }
    const topicId = textToTopicId.get(tr.topicText) ?? null;
    const metaByArticle = new Map((tr.matchMeta ?? []).map(m => [m.articleId, m]));
    for (const articleId of tr.articleIds ?? []) {
      const mm = metaByArticle.get(articleId);
      pushMatched(articleId, {
        topicId,
        text: tr.topicText,
        vectorScore: mm?.vectorScore ?? null,
        stableClusterId: mm?.stableClusterId ?? null
      });
      if (mm?.stableClusterId && !stableClusterId.has(articleId)) {
        stableClusterId.set(articleId, mm.stableClusterId);
      }
    }
  }

  // Headline injection: synthetic matched-topic (topicId null) + headline_scope.
  for (const hr of res.headlineResults ?? []) {
    const scopeLabel = hr.scope === _graphqlTypes.HeadlineScope.Country ? 'COUNTRY' : 'GLOBAL';
    const label = `top headline · ${scopeLabel.toLowerCase()}`;
    // The scope's own country, normalized. GLOBAL results carry none by
    // construction; a COUNTRY result missing one is treated as unknown rather
    // than persisting an empty string.
    const scopeCountry = scopeLabel === 'COUNTRY' ? (hr.countryCode ?? '').trim().toUpperCase() : '';
    const ids = hr.articleIds ?? [];
    const stableIds = hr.stableClusterIds ?? [];
    ids.forEach((articleId, i) => {
      pushMatched(articleId, {
        topicId: null,
        text: label,
        vectorScore: null,
        stableClusterId: stableIds[i] ?? null
      });
      // Topic-retrieved match wins over a headline scope when both apply.
      // Scope LABEL and scope COUNTRY are written under the SAME first-writer
      // guard: setting them independently would let an article that appeared
      // in GLOBAL first and a COUNTRY scope second end up labelled GLOBAL
      // while carrying a country code — an incoherent row.
      if (!headlineScope.has(articleId)) {
        headlineScope.set(articleId, scopeLabel);
        if (scopeCountry) headlineCountryCode.set(articleId, scopeCountry);
      }
      const sid = stableIds[i];
      if (sid && !stableClusterId.has(articleId)) stableClusterId.set(articleId, sid);
    });
  }

  // TOPICS FIRST, HEADLINES LAST: insertion order is load-bearing, do not reorder.
  //
  // `matchedTopics` is a Map, so `[...keys()]` yields INSERTION order, and the
  // topic loop above runs before the headline loop. Whatever later trims this
  // list by position trims headlines before the reader's own subjects: the
  // background run's per-run fetch cap (`shapeBackgroundDiff`), and the
  // progressive render, which shows the first chunks first. Sorting this array,
  // swapping the two loops or merging them would still pass every metadata
  // assertion here; two order tests pin the order itself.
  const serverArticleIds = [...matchedTopics.keys()];
  _logger.default.debug(`[feed-sync-steps] articleIdsForPersona returned ${serverArticleIds.length} article ids`);
  ctx.log(`server returned ${serverArticleIds.length} article ids (persona path)`);
  return {
    articleToTopicTexts,
    serverArticleIds,
    personaMeta: {
      matchedTopics,
      headlineScope,
      headlineCountryCode,
      stableClusterId
    },
    // Billing partition input. The SAME set that decided `strictMatch` on the
    // wire above, derived from the SAME activeTopics snapshot the retrieval
    // profile was built from, so the three can't disagree about which texts
    // were sent as tracked.
    freeTopicTexts
  };
}
async function stepDiff(result, ctx) {
  if (ctx.signal.aborted) throw (0, _retry.createCancellationError)();
  const {
    serverArticleIds,
    articleToTopicTexts,
    personaMeta,
    freeTopicTexts
  } = result;
  const localIds = await (0, _articleSuggestionReads.getLocalSuggestionServerIds)();
  const localIdSet = new Set(localIds);
  const missingIds = serverArticleIds.filter(id => !localIdSet.has(id));
  ctx.log(`${missingIds.length} missing ids to hydrate`);

  // Billing partition. Deliberately AFTER the new-to-device filter and derived
  // from that single filtered array: the local-id read happens exactly once, so
  // the two hydration calls can never both see the same id, and there is no
  // window in which a stale local set could let one through twice.
  const {
    storyIds,
    personaIds
  } = partitionStoryIds(missingIds, articleToTopicTexts, freeTopicTexts, personaMeta?.headlineScope);
  if (storyIds.length > 0) {
    ctx.log(`${storyIds.length} of them are followed-story only (hydrated quota-free)`);
  }
  return {
    serverArticleIds,
    articleToTopicTexts,
    missingIds,
    storyIds,
    personaIds,
    personaMeta
  };
}

/** Settings row: epoch ms of the last membership refresh attempt (stamped before the request). */
const CLUSTER_MEMBERSHIP_REFRESH_KEY = exports.CLUSTER_MEMBERSHIP_REFRESH_KEY = 'cluster_membership_refresh_at';
const CLUSTER_MEMBERSHIP_REFRESH_EVERY_MS = exports.CLUSTER_MEMBERSHIP_REFRESH_EVERY_MS = 60 * 60_000;
/** The ML job clusters a 48h window and deletes older generations, so an older row has
 *  no links left and its answer would clear the memberships that group its story.
 *  Older rows (the 7-day keep) keep their last memberships. */
const CLUSTER_MEMBERSHIP_MAX_AGE_MS = exports.CLUSTER_MEMBERSHIP_MAX_AGE_MS = 44 * 60 * 60_000;

/**
 * The hourly cluster-membership refresh: rows hydrated before the clustering
 * job grouped them carry stale memberships, so copies of one story show as
 * separate cards. Asks once about the newest rows published within {@link CLUSTER_MEMBERSHIP_MAX_AGE_MS}, and writes what
 * changed. Returns the changed-row count; never throws (a failure waits an hour).
 */
async function stepRefreshClusterMemberships(suggestions) {
  try {
    const now = Date.now();
    const last = Number(await (0, _settingService.getSetting)(CLUSTER_MEMBERSHIP_REFRESH_KEY));
    if (Math.abs(now - last) < CLUSTER_MEMBERSHIP_REFRESH_EVERY_MS) return 0;
    const cutoff = now - CLUSTER_MEMBERSHIP_MAX_AGE_MS;
    const fresh = suggestions.map(s => ({
      s,
      pub: Date.parse(s.firstPubDate)
    })).filter(({
      pub
    }) => pub >= cutoff);
    // The gate only decides WHEN to ask. The request carries every fresh row whatever its
    // score, so the ids equal what the server already sent and say nothing about relevance.
    if (!fresh.some(({
      s
    }) => (0, _factRowsSelector.passesRenderGate)(s))) return 0;
    const ids = fresh.sort((a, b) => b.pub - a.pub).slice(0, _articleService.MAX_CLUSTER_MEMBERSHIP_IDS).map(({
      s
    }) => s.articleId);
    await (0, _settingService.setSetting)(CLUSTER_MEMBERSHIP_REFRESH_KEY, String(now));
    const answer = await _articleService.ArticleService.getClusterMembershipsForArticles(ids);
    return answer ? await (0, _articleSuggestionPersist.updateClusterMemberships)(answer) : 0;
  } catch (err) {
    _logger.default.warn('[feed-sync-steps] cluster membership refresh failed', {
      error: String(err)
    });
    return 0;
  }
}

/**
 * Fire-and-forget growth of every followed story from this run. `serverMatches`
 * is the run's server answer (article id → matched topics), so rows already on
 * device join a story too. Never throws.
 */
function growTrackedStories(serverMatches) {
  // First upgrade any legacy stable-cluster follows to the
  // topic model (one-shot + idempotent — a cheap no-op once none remain), THEN
  // grow every followed topic from whatever this run just persisted (the
  // suggestions' matched_topics). Chained so a just-migrated story also grows
  // this same cycle. Runs after every persist attempt — including a
  // partial one (a server that still caps downloads), since whatever landed is still a valid
  // reconcile source — AND on a run with nothing new to download, because the
  // server answer alone places rows already on device (a story just followed
  // from a feed card). Must never fail or delay the sync itself.
  (0, _trackActions.migrateLegacyTrackedStories)().catch(err => {
    _logger.default.captureException(err, {
      tags: {
        component: 'feed-sync-steps',
        method: 'migrateLegacyTrackedStories'
      }
    });
  }).finally(() => {
    (0, _trackedStoryReconcile.reconcileTrackedStories)(serverMatches).catch(err => {
      _logger.default.captureException(err, {
        tags: {
          component: 'feed-sync-steps',
          method: 'reconcileTrackedStories'
        }
      });
    }).finally(() => {
      // One-shot, self-disabling: retain the members of stories followed
      // before retention existed, for whichever of them are still inside
      // the 48h suggestion window. Last in the chain so it sees the members
      // this cycle just added.
      (0, _trackActions.backfillTrackedStoryRetention)().catch(err => {
        _logger.default.captureException(err, {
          tags: {
            component: 'feed-sync-steps',
            method: 'backfillTrackedStoryRetention'
          }
        });
      });
    });
  });
}

/**
 * Merged hydrate + persist + enqueue step (runs under the `hydrating` state).
 *
 * Chunks are hydrated with concurrency `HYDRATE_CONCURRENCY` (a
 * simple promise pool, no new deps). For each chunk a worker downloads the full
 * records (one server query), persists + links them, marks ineligible rows
 * scored, refreshes the store for progressive rendering, and — if the chunk
 * produced eligible ids — runs the gate + enqueue step so full 25-article quanta
 * dispatch MID-hydration (greedy overlap) instead of only once at the end. The
 * gate+enqueue invocations are serialized behind a promise chain so they never
 * run concurrently (the gate re-derives its candidates from ALL unscored,
 * not-in-flight rows, and enqueueCandidates applies the strict quantum gate).
 *
 * A server that still caps downloads answers with fewer articles (a granted
 * prefix, possibly none) and no error. What arrives is persisted; the ids that
 * did not arrive stay new-to-device and are asked for again on the next sync.
 */
async function stepHydratePersistEnqueue(diffResult, ctx, opts) {
  if (ctx.signal.aborted) throw (0, _retry.createCancellationError)();
  const {
    missingIds,
    articleToTopicTexts,
    personaMeta
  } = diffResult;
  // Fail METERED, not free. A DiffResult that never went through the billing
  // partition hydrates exactly as it did before the free partition — charging for everything —
  // rather than silently routing the whole run through the unmetered query.
  const storyIds = diffResult.storyIds ?? [];
  const personaIds = diffResult.personaIds ?? missingIds;

  // Two hydrators, one pool. Followed-story-only ids go through the quota-EXEMPT
  // `articlesForStories`; everything else through the METERED
  // `articlesForTopicsByIds`. The two id arrays are disjoint (partitioned once,
  // in stepDiff), so no article can be fetched — or charged — twice.
  //
  // Everything downstream of the response is IDENTICAL for both: same persist,
  // same link, same gate, same enqueue. The only thing that differs is which
  // server query delivered the rows.
  const chunks = [...chunkArray(storyIds, HYDRATE_CHUNK_SIZE).map(ids => ({
    ids,
    free: true
  })), ...chunkArray(personaIds, HYDRATE_CHUNK_SIZE).map(ids => ({
    ids,
    free: false
  }))];
  let completedIds = 0;
  let insertedCount = 0;
  let enqueuedCount = 0;
  const collectedEligibleIds = [];
  // Set on a mid-run abort: stops the pool from launching further chunks.
  let stopLaunching = false;

  // Lazy require (not a static import) breaks the module-load cycle
  // feed-sync-steps → scoring-pipeline → SuggestionSyncService → run-inference-
  // handler → feed-sync-steps. Same pattern as lib/database/hydrate-stores.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const scoringPipeline = require("../../services/scoring-pipeline");
  const {
    enqueueCandidates,
    getNonTerminalCoveredIds
  } = scoringPipeline;

  // Serialize gate+enqueue: the gate scans ALL unscored rows and enqueueCandidates
  // dispatches quanta, so two concurrent invocations could double-count. A simple
  // promise chain guarantees one-at-a-time execution across the parallel workers.
  let gateChain = Promise.resolve();
  const runGateSerialized = fn => {
    const next = gateChain.then(fn, fn);
    // Keep the chain alive even if fn rejects, so one failure doesn't wedge the
    // rest. Individual failures still surface via the awaited `next`.
    gateChain = next.then(() => undefined, () => undefined);
    return next;
  };

  // Resolve the user's geo/language context once for the whole run and reuse it
  // across every serialized gate call — its country/language priority steers
  // which sibling of a duplicate group gets elected to score. Fails open to
  // null (legacy, geo/language-blind election).
  const userCtx = await (0, _userGeoLanguageContext.loadUserGeoLanguageContext)();

  // On-device mode scores on the device: stepScore -> runScoringPass runs the
  // local model over every unscored row. Enqueueing the same rows into the E2EE
  // cloud pipeline here made the two lanes race on them, and the cloud lane won,
  // which both broke the mode's premise and hid local failures. Read once per
  // run, like the other run-scoped inputs above.
  const onDeviceScoring = _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.OnDevice;
  // A transport with no async jobs scores inline in stepScore, the same way.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    transportServesJobs
  } = require("../../llm/cloudComplete");
  const cloudEnqueue = !opts.suppressEnqueue && !onDeviceScoring && transportServesJobs();

  // Already-read index: ONE read of `story_impressions` for the whole run,
  // shared by the pre-persist screen (per chunk) and the unscored-backfill
  // screen inside `markIneligibleAndCollectEligible`. A sync is short relative
  // to the 30-day impression TTL, so a snapshot taken here cannot go
  // meaningfully stale mid-run; rebuilding per chunk would just re-read the same
  // table N times. Fails open to an inert index (nothing excluded).
  const readIndex = await (0, _readStoryFilter.loadReadStoryIndex)();
  let readSkippedTotal = 0;

  // The gate re-derives its candidates from ALL unscored, not-in-flight rows —
  // not just this chunk's eligible ids — so any sibling held back or missed by a
  // failed batch on a prior chunk/sync is re-considered. Self-healing with no
  // persisted held-back state: a held-back sibling is either propagated (its rep
  // scored) or re-enqueued next pass.
  // The trailing sub-25 partial the most recent enqueue held back (empty when
  // nothing was deferred). Flushed to scoring once the whole lot is hydrated.
  let pendingDeferred = [];
  // That same pass's gate coverage (rep id → the duplicate group it stands in
  // for), carried alongside so the tail flush records the same article coverage
  // the greedy enqueues did — otherwise the flushed remainder would look like it
  // covers only itself and undercount the header's denominator.
  let pendingCoveredIdsByRep = {};
  const gateAndEnqueue = async () => {
    // Covered, not candidate-only: a sibling held back behind a live batch's rep
    // must not be elected again by the next chunk's gate.
    const inFlight = await getNonTerminalCoveredIds();
    const gate = await (0, _scorePropagation.gateUnscoredForScoring)(inFlight, userCtx, readIndex);
    if (gate.propagatedCount > 0) {
      // Propagated rows were written terminal `complete` WITHOUT passing
      // the scoring stage's hard screen. Reconcile against the live hard
      // filters BEFORE the store refresh, so a "Blocked" article never reaches
      // the feed even for one frame. Never fails the sync — the propagation is
      // already committed and the next filter mutation sweeps the table anyway.
      try {
        await reconcileHardFilters();
      } catch (err) {
        _logger.default.captureException(err, {
          tags: {
            service: 'feed-sync-steps',
            step: 'reconcile-hard-filters'
          }
        });
      }
      // Propagated rows are now terminal `Complete` — surface them immediately.
      await opts.refreshStore();
    }
    // The propagation half above always runs — it is what turns a duplicate of
    // an already-scored story into a `Complete` row without any inference. Only
    // the dispatch is suppressed.
    if (cloudEnqueue && gate.enqueueIds.length > 0) {
      const res = await enqueueCandidates(gate.enqueueIds, false, gate.coveredIdsByRep);
      pendingDeferred = res.deferred;
      pendingCoveredIdsByRep = gate.coveredIdsByRep ?? {};
    }
    if (cloudEnqueue) enqueuedCount += gate.enqueueIds.length;
    readSkippedTotal += gate.readCount;
    const enqueuedLabel = onDeviceScoring ? `${gate.enqueueIds.length} left for on-device scoring` : opts.suppressEnqueue ? `${gate.enqueueIds.length} left unscored (enqueue suppressed)` : `enqueued ${gate.enqueueIds.length}`;
    const gateLine = `gate: propagated ${gate.propagatedCount}, held back ${gate.heldBackCount}, ${enqueuedLabel}, read ${gate.readCount}`;
    ctx.log(gateLine);
    _logger.default.debug(`[feed-sync-steps] ${gateLine}`);
    coldstartTimeline.mark('first-gate-enqueue', `enqueued=${gate.enqueueIds.length} heldBack=${gate.heldBackCount} propagated=${gate.propagatedCount}`);
  };
  let nextChunk = 0;
  const worker = async () => {
    for (;;) {
      if (stopLaunching) return;
      // Cooperative points: pause while offline, bail on abort.
      await opts.awaitResumeIfPaused();
      if (ctx.signal.aborted || opts.stopAt !== undefined && Date.now() >= opts.stopAt) {
        stopLaunching = true;
        return;
      }
      const i = nextChunk++;
      if (i >= chunks.length) return;
      const {
        ids: chunk,
        free
      } = chunks[i];
      const onChunkProgress = chunkCompleted => opts.onProgress(completedIds + chunkCompleted);
      const response = await (0, _retry.withRetry)(() => free ? _articleService.ArticleService.getArticlesForStories(chunk, onChunkProgress) : _articleService.ArticleService.getArticlesForTopicsByIds(chunk, onChunkProgress), ctx.signal, RESOLVER_ERROR_RETRIES);
      const chunkArticles = response.articles;

      // ALREADY-READ SCREEN.
      const {
        toPersist,
        readCount: chunkReadSkipped
      } = splitAlreadyReadArticles(chunkArticles, readIndex);
      readSkippedTotal += chunkReadSkipped;
      if (chunkReadSkipped > 0) {
        ctx.log(`skipped ${chunkReadSkipped} already-read articles`);
      }
      if (toPersist.length > 0) {
        const {
          insertedCount: chunkInserted
        } = await (0, _articleSuggestionPersist.persistAndLinkV2Suggestions)(toPersist, articleToTopicTexts, personaMeta);
        insertedCount += chunkInserted;
        coldstartTimeline.mark('first-hydration-chunk-persisted', `persisted=${chunkInserted}`);
        const chunkIdSet = new Set(toPersist.map(a => a._id));
        const {
          ineligibleCount,
          alreadyReadCount,
          eligibleIds
        } = await markIneligibleAndCollectEligible(chunkIdSet, readIndex);
        if (ineligibleCount > 0) {
          ctx.log(`pre-scored ${ineligibleCount} ineligible articles`);
        }
        if (alreadyReadCount > 0) {
          readSkippedTotal += alreadyReadCount;
          ctx.log(`marked ${alreadyReadCount} already-synced rows as already read`);
        }
        collectedEligibleIds.push(...eligibleIds);

        // Progressive rendering: newly-persisted (unscored) articles appear now.
        await opts.refreshStore();
        // Yield the JS thread so the just-rendered chunk can paint.
        await (0, _idle.yieldToEventLoop)();

        // Greedy overlap: if this chunk produced eligible ids, run the
        // gate+enqueue now (serialized) so accumulated full quanta dispatch
        // mid-hydration instead of only once at the end.
        if (eligibleIds.length > 0) {
          await runGateSerialized(() => gateAndEnqueue());
        }
      }
      completedIds += chunk.length;
      opts.onProgress(completedIds);
      ctx.log(`chunk ${i + 1}/${chunks.length}: persisted ${toPersist.length}`);
      _logger.default.debug(`[feed-sync-steps] chunk ${i + 1}/${chunks.length}: persisted ${toPersist.length}`);
    }
  };
  const poolSize = Math.min(HYDRATE_CONCURRENCY, Math.max(1, chunks.length));
  await Promise.all(Array.from({
    length: poolSize
  }, () => worker()));
  // Drain any still-pending serialized gate invocation before returning.
  await gateChain;

  // Every propagation write of this run is now committed — sweep the LOW-band
  // headline cull to convergence (backfill + propagation leak; see
  // `cullLowHeadlines`). Never fails the sync: the rows are already persisted
  // and the next sync sweeps them again.
  try {
    await cullLowHeadlines();
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        component: 'feed-sync-steps',
        method: 'cullLowHeadlines'
      }
    });
  }

  // Tail flush: the whole lot is now hydrated and we won't refetch until it's
  // scored, so dispatch the sub-MIN_DISPATCH remainder the gate held back
  // instead of letting it wait out MAX_UNSCORED_WAIT_MS (~30 min) for articles
  // that will never arrive this cycle. These ids were already gate-elected, so
  // we enqueue them directly with flushPartial=true (no extra gate pass). Never
  // let a flush failure fail the (already-hydrated) step.
  if (!ctx.signal.aborted) {
    try {
      if (onDeviceScoring) {
        // Nothing to flush: stepScore scores these rows on the device.
      } else if (cloudEnqueue && pendingDeferred.length > 0) {
        await enqueueCandidates(pendingDeferred, true, pendingCoveredIdsByRep);
      } else if (opts.suppressEnqueue && !opts.background && (await scoringPipeline.getPipelineStatus()) === 'idle') {
        // Suppressed cycle: we hydrated rows but never enqueued them, because a
        // scoring run was in flight. If that run finished while we were
        // hydrating, WE are the handoff — the pipeline's own post-finalize kick
        // either ran before these rows landed, or skipped its flush precisely
        // because it saw feed-sync busy. Re-elect from the DB and flush, or
        // these rows sit unscored until the 30-minute staleness escape.
        await scoringPipeline.enqueueUnscoredEligible({
          flushRemainder: true
        });
      }
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          component: 'feed-sync-steps',
          method: 'tailFlush'
        }
      });
    }
  }
  ctx.log(`hydrated+persisted ${insertedCount} records, enqueued ${enqueuedCount}` + (readSkippedTotal > 0 ? `, already read ${readSkippedTotal}` : ''));
  growTrackedStories(diffResult.personaMeta?.matchedTopics);
  return {
    insertedCount,
    enqueuedCount,
    eligibleIds: collectedEligibleIds
  };
}
async function stepScore(ctx) {
  if (ctx.signal.aborted) throw (0, _retry.createCancellationError)();
  const {
    runScoringPass
  } = await Promise.resolve().then(() => _interopRequireWildcard(require("../../services/SuggestionSyncService")));
  return runScoringPass();
}

// --- Internal helpers ---

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Partition the currently-unscored suggestions: mark the ineligible ones
 * (missing English title/description, or factless AND not headline-sourced) as
 * scored so they never enter scoring, and return the eligible ids that belong to
 * THIS chunk so they can be enqueued. Global scan (like the pre-merge
 * `markIneligible…`), but the returned eligible set is scoped to the chunk just
 * persisted.
 *
 * The admission test is `isScorableCandidate`, NOT `isEligible`: a TOP-HEADLINE
 * row is factless by design (its matched topic is synthetic, `topicId: null`,
 * so `persistAndLinkV2Suggestions` links no fact to it). This ran at every
 * chunk, over ALL unscored rows, immediately after persist and BEFORE
 * gate+enqueue — so the old `relatedFacts.length === 0` test wrote every pure
 * headline terminal (`relevance 0`, `reason ''`, `status complete`) before any
 * scoring existed, with no timing window to escape through. Rows missing
 * title/description are still tombstoned: no prompt can score empty text.
 *
 * ALREADY-READ BACKFILL. The pre-persist screen upstream only
 * sees THIS run's server response; it cannot help a row synced on an earlier
 * cycle and still `unscored` when the user finally read that story. This global
 * unscored scan is exactly where such a row is visible, so it doubles as the
 * backfill: matches are written terminal `already_read` (never enqueued, never
 * scored) instead of being marked ineligible-`complete`, which would be a lie
 * about why they are invisible. The read screen runs FIRST — a row that is both
 * already-read and ineligible is more usefully counted as already-read, and it
 * keeps the two counts from double-billing the same id.
 */
async function markIneligibleAndCollectEligible(chunkIds, readIndex) {
  const all = await (0, _articleSuggestionReads.getUnscoredSuggestionsWithFacts)();
  const alreadyRead = readIndex.impressionCount === 0 ? [] : all.filter(c => (0, _readStoryFilter.matchesReadStory)({
    // A suggestion's WMDB row id IS the server article id.
    articleId: c.id,
    title: c.titleEn
  }, readIndex));
  if (alreadyRead.length > 0) {
    // Never fails the sync. If the write is lost these rows simply stay
    // `unscored` and the gate — which re-derives from ALL unscored rows on the
    // very next pass — marks them then. Self-healing, so swallowing is safe;
    // they are still withheld from THIS chunk's eligible ids either way.
    try {
      await (0, _readStoryFilter.batchMarkAlreadyRead)(alreadyRead.map(c => c.id));
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          component: 'feed-sync-steps',
          method: 'batchMarkAlreadyRead'
        }
      });
    }
  }
  const alreadyReadIds = new Set(alreadyRead.map(c => c.id));
  const candidates = alreadyReadIds.size === 0 ? all : all.filter(c => !alreadyReadIds.has(c.id));
  const ineligible = candidates.filter(c => !(0, _scoring.isScorableCandidate)(c));
  if (ineligible.length > 0) {
    await (0, _articleSuggestionScoringWrites.batchMarkAsScoredByIds)(ineligible.map(c => c.id));
  }
  const eligibleIds = candidates.filter(_scoring.isScorableCandidate).filter(c => chunkIds.has(c.id)).map(c => c.id);
  return {
    ineligibleCount: ineligible.length,
    alreadyReadCount: alreadyRead.length,
    eligibleIds
  };
}