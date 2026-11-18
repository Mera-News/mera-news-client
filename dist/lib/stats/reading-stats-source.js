"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.loadReadingStats = loadReadingStats;
var _publicationVisitService = require("../database/services/publication-visit-service");
var _savedArticleSuggestionService = require("../database/services/saved-article-suggestion-service");
var _trackedStoryService = require("../database/services/tracked-story-service");
var _logger = _interopRequireDefault(require("../logger"));
var _rxjs = require("rxjs");
var _readingStats = require("./reading-stats");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// reading-stats-source — the WatermelonDB adapter for the Mera Stats card.
//
// Deliberately logic-free, mirroring the split the repo already uses for
// fact-stats (pure core beside a service that only reads rows): every decision
// about windows, dedup, coverage and labelling lives in `reading-stats.ts`, and
// everything here is a read plus a field rename. If a rule starts to appear in
// this file it is in the wrong file.
//
// It ADDS NOTHING. All four tables it reads already exist to operate the
// product: `publication_visits` runs the Sources tab, `story_impressions` runs
// feed dedup and the read-story filter, `saved_article_suggestions` runs the
// Saved tab and `tracked_stories` runs the Stories tab. No schema change, no
// migration, no new column, no new counter. Hard invariant 9 forbids the
// alternative, and the test for a new counter is "does the product stop working
// without it", not "is it anonymous".
//
// ## Why the last two go through the same readers the tabs use
//
// `loadSavedItems` and `observeActive` are the exact calls the Saved and
// Stories sub-tabs render from, not cheaper hand-rolled counts. That is the
// point: a count that disagrees with the list the reader can open and tally
// themselves is worse than no count. It also means the saved figure inherits
// `loadSavedItems`'s retention filter for free — rows with `origin`
// 'fact_check' or 'tracked_story' are kept to make an article openable, not
// saved by anyone, and counting them would both overstate saves and
// double-count a followed story's members against the followed figure.
//
// ## Why there is no "articles analysed by AI" figure here
//
// Because no device-local record of it exists, and one may not be created.
// `article_suggestions.relevance_generation_completed` is a genuine per-article
// record that the scoring pass ran, but that table is swept at 48h
// (`SUGGESTION_TTL_MS`), so a 30-day tally is unrecoverable and even a 48-hour
// one would silently undercount by every row already swept. `inference_jobs`
// has no scoring job type at all and is pruned at one hour. `story_impressions`
// has the right window and no scoring column, and conflating "reached the feed"
// with "was analysed" would overcount anyway, because
// `propagateToUnscoredSiblings` exists precisely so a sibling can inherit a
// score without being scored. The server's `articlesUsedToday` counts article
// IDs DELIVERED per UTC day, which is a different set and a different claim,
// and reading it would also make the card's own "Nothing left it" line false.
// The app keeps no running tally of its own work because nothing in the product
// needs one to function. Do not add one.

/**
 * Reads both tables and hands them to the pure core.
 *
 * Returns the empty shape rather than throwing when a read fails: this powers a
 * share card, and a crashed preview screen is a worse outcome than a card that
 * says there is nothing to show yet. Both underlying services already swallow
 * and report their own errors, so this catch is the belt to their braces.
 */
async function loadReadingStats(options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  try {
    const [visits, savedItems, trackedStories] = await Promise.all([(0, _publicationVisitService.getAllVisitedArticles)(), (0, _savedArticleSuggestionService.loadSavedItems)(),
    // `observeActive` is a live query, and a WatermelonDB observable emits its
    // current rows on subscribe rather than waiting for a change, so the first
    // value is the answer and `firstValueFrom` unsubscribes as soon as it has
    // it. Each of the four failing independently is why they share one catch:
    // any of them throwing gives an empty card, never a half-true one.
    (0, _rxjs.firstValueFrom)((0, _trackedStoryService.observeActive)())]);
    return (0, _readingStats.computeReadingStats)({
      visits,
      nowMs,
      keptNow: {
        savedArticles: savedItems.length,
        followedStories: trackedStories.length
      },
      ...(options.topPublicationLimit !== undefined ? {
        topPublicationLimit: options.topPublicationLimit
      } : {})
    });
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'reading-stats',
        method: 'loadReadingStats'
      }
    });
    return (0, _readingStats.emptyReadingStats)();
  }
}