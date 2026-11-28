"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.backfillTrackedStoryRetention = backfillTrackedStoryRetention;
exports.disownStoryMember = exports.deleteTrackedStoryById = void 0;
exports.isSubjectTracked = isSubjectTracked;
exports.migrateLegacyTrackedStories = migrateLegacyTrackedStories;
exports.observeSubjectTrackedId = observeSubjectTrackedId;
exports.retainStoryMember = retainStoryMember;
exports.syncFollowedStoryNow = syncFollowedStoryNow;
exports.trackStoryWithProposal = void 0;
var _trackedStoryService = require("../database/services/tracked-story-service");
var _topicService = require("../database/services/topic-service");
var _articleSuggestionReads = require("../database/services/article-suggestion-reads");
var _savedArticleSuggestionService = require("../database/services/saved-article-suggestion-service");
var _settingService = require("../database/services/setting-service");
var _inferenceJobService = require("../database/services/inference-job-service");
var _trackedStoryMigrateHandler = require("../inference/handlers/tracked-story-migrate-handler");
var _InferenceQueue = require("../inference/InferenceQueue");
var _meraProtocolStore = require("../stores/mera-protocol-store");
var _graphqlTypes = require("../generated/graphql-types");
var _logger = _interopRequireDefault(require("../logger"));
var _command = require("../sync/command");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Track-flow helper — the single entry point card/detail surfaces call to
// follow (or unfollow) a story from a FeedbackSubject.
//
// A followed story is just a durable TOPIC. "Track" opens the floating Mera
// chat; the proposeTrack tool proposes 3–4 scope pills (a shown display label +
// a hidden search query); confirming lands here. We mint a `topics` row keyed on
// the SEARCH text (the durable link the persona query grows from each fetch
// cycle) plus a local `tracked_stories` row that shows the display LABEL as its
// headline and seeds the tapped article. The story then grows every fetch cycle
// via the topic reconcile, exactly like any other topic — there is no
// server-side stable-cluster archive and no relevance pipeline for it.

/** Seed weight for a topic minted from "Track story" — high enough to retrieve
 *  strongly (see retrieval-profile), below a hand-pinned 1.0. */
const TRACKED_TOPIC_WEIGHT = 0.85;

/** The scope pill the user confirmed in the follow-a-story card: the shown
 *  display `label` and the hidden `searchText` retrieval query. `label` is what
 *  the tracked-story UI shows; `searchText` is minted as the tracked topic. */

/** Build the lean member snapshot for the originating (tapped) article. We stamp
 *  the subject's REAL pubDate when known so the timeline orders by publication
 *  time, not the track moment. The topic reconcile supplies richer snapshots for
 *  later members from local suggestion data.
 *
 *  UNKNOWN pubDate falls back to 0, NOT `Date.now()`. `Date.now()` was actively
 *  harmful: every timeline row renders publication age under the same clock
 *  chip, so a seed with no date claimed to be seconds old and sorted itself to
 *  the top — a 13h-old article displayed as "4m ago" above genuinely fresher
 *  coverage. 0 is the sentinel the rest of the service already reads as "old /
 *  unknown" (see the unseen-count watermark): it sorts last and the card simply
 *  renders no timestamp rather than a false one. Callers should still pass a
 *  real `pubDate` — every current one does. */
function snapshotFromSubject(subject) {
  const parsed = subject.pubDate ? Date.parse(subject.pubDate) : NaN;
  const pubDateMs = Number.isFinite(parsed) ? parsed : 0;
  return {
    articleId: subject.articleId,
    title: subject.title ?? '',
    pubDateMs,
    // No publication and no language on the seed (owner: a story is not the
    // publication it was followed from). The timeline resolves both from the
    // local suggestion row on first open (see `hydrateSource`).
    countryCode: subject.countryCode ?? undefined
  };
}

/**
 * Follow the story described by `subject` as a TOPIC, using the scope pill the
 * user accepted in the floating Mera chat (proposeTrack → ProposalCard Confirm →
 * executeProposalActions). Mints a `topics` row keyed on the accepted SEARCH
 * text (the durable link the persona query grows from), then creates the local
 * TrackedStory carrying that topic id, the display LABEL as its headline, and
 * the originating article as its first snapshot. Returns once the row exists,
 * then starts a feed sync whose topic reconcile fills in the coverage.
 */
async function trackStoryWithProposalLocal(subject, scope, opts = {}) {
  const label = (scope.label ?? '').trim();
  const searchText = (scope.searchText ?? '').trim();
  // The search text is what actually retrieves articles — without it there is
  // nothing to follow.
  if (!searchText) return 'skipped';

  // IDEMPOTENCE. This ran unconditionally, so every confirmed proposal minted a
  // fresh topic AND a fresh tracked_stories row — the duplicate followed stories
  // users hit. A stale button was one route in; it is not the only one, because
  // the floating chat outlives the screen and a second proposal can be confirmed
  // from anywhere. Guarding the WRITE is what actually makes duplicates
  // impossible, so the check belongs here rather than only in the button.
  const existing = await (0, _trackedStoryService.findActiveTrackedId)({
    stableClusterId: subject.stableClusterId ?? null,
    articleId: subject.articleId,
    searchText
  });
  if (existing) {
    _logger.default.info('[track-actions] story already tracked — skipping duplicate mint', {
      id: existing
    });
    return 'already';
  }

  // 1. Mint the topic keyed on the SEARCH text. Continue even if this fails; the
  //    story still tracks locally against its origin article.
  let topicId = null;
  try {
    const [topic] = await (0, _topicService.createTopics)([{
      text: searchText,
      weight: TRACKED_TOPIC_WEIGHT,
      status: 'active',
      provenance: 'tracked',
      highPriority: true
    }]);
    topicId = topic?.id ?? null;
  } catch (err) {
    _logger.default.warn('[track-actions] topic mint failed', {
      error: String(err)
    });
  }
  if (!topicId && opts.requireTopic) return 'skipped';

  // The local row, read once: it supplies the seed's fold keys (the subject
  // carries neither the original title nor the story key) and the retention
  // below. A follow from World or Search has no row and folds on the title key
  // alone. The seed keeps no publicationName or languageCode (owner rule), and
  // its pubDate stays the subject's, so the unseen watermark is unchanged.
  const row = await (0, _articleSuggestionReads.getSuggestionByArticleId)(subject.articleId);

  // 2. Create the local story row: display LABEL as the headline, SEARCH text as
  //    the tracked topic, seeded with the tapped article snapshot.
  const story = {
    stableClusterId: subject.stableClusterId ?? null,
    articleId: subject.articleId,
    title: subject.title,
    originSurface: subject.surface,
    topicId,
    topicText: searchText,
    llmHeadline: label || searchText,
    initialSnapshot: {
      ...snapshotFromSubject(subject),
      titleOriginal: row?.title_original || undefined,
      storyKey: row?.storyKey || undefined
    }
  };
  try {
    await (0, _trackedStoryService.trackStory)(story);
  } catch (err) {
    // A topic with no story row is an orphan: retry once, and the feed-sync rebuild heals the rest.
    if (!topicId) throw err;
    _logger.default.warn('[track-actions] story write failed, retrying', {
      error: String(err)
    });
    await (0, _trackedStoryService.trackStory)(story);
  }

  // 3. Retain the seed article on device, the way a save does.
  //
  // Without this the story outlives its own articles: the member snapshot holds
  // no description and no URL, `article_suggestions` is pruned at 48h, and the
  // server drops the article at 48h too — so opening a two-day-old member from
  // a story the reader deliberately followed shows "no longer available".
  //
  // Resolve the local suggestion first. `subject` is a FeedbackSubject and
  // carries neither the description nor the article URL, and the URL is the
  // whole point: without it the detail screen renders a header with no Read
  // button. Degrade to the subject only when the row is genuinely gone.
  await retainStoryMember(subject.articleId, {
    title: subject.title,
    publicationName: subject.publicationName
  }, row);

  // 4. Fetch the story's coverage now rather than at the next 5-minute tick.
  if (topicId && opts.syncFeed !== false) void syncFollowedStoryNow();
  return 'followed';
}
const trackStoryWithProposal = exports.trackStoryWithProposal = (0, _command.command)('trackStoryWithProposal', trackStoryWithProposalLocal);

/**
 * Run a feed sync for a story just followed. A sync already in flight read the
 * topics before this one existed, so wait it out and run once more. Story ids
 * are quota-exempt, so this costs the reader nothing. Never throws.
 */
async function syncFollowedStoryNow() {
  try {
    // Call-time requires: the scheduler pulls the WatermelonDB singleton and
    // every task module, which must stay out of this module's import graph.
    const {
      AppScheduler
    } = require("../scheduler/AppScheduler");
    const {
      useSchedulerStore
    } = require("../scheduler/scheduler-store");
    const run = () => AppScheduler.trigger('feed-sync', undefined, {
      bypassDebounce: true
    });
    if ((await run()) !== 'busy') return;
    await new Promise(resolve => {
      const done = () => !useSchedulerStore.getState().isRunning('feed-sync');
      if (done()) return resolve();
      const unsub = useSchedulerStore.subscribe(() => {
        if (done()) {
          unsub();
          resolve();
        }
      });
    });
    await run();
  } catch (err) {
    _logger.default.warn('[track-actions] follow sync failed', {
      error: String(err)
    });
  }
}

/**
 * Retain one followed-story member article on device.
 *
 * Never throws: retention is a durability nicety and must not fail the follow,
 * or the sync, that it rode in on.
 */
async function retainStoryMember(articleId, fallback, /** The local row when the caller already read it (saves a second read). */
known) {
  const id = (articleId ?? '').trim();
  if (!id) return;
  try {
    const suggestion = known ?? (await (0, _articleSuggestionReads.getSuggestionByArticleId)(id));
    if (suggestion) {
      await (0, _savedArticleSuggestionService.keepArticleForTrackedStory)({
        articleId: id,
        suggestion
      });
      return;
    }
    if (fallback?.title || fallback?.publicationName) {
      await (0, _savedArticleSuggestionService.keepArticleForTrackedStory)({
        articleId: id,
        title: fallback.title ?? null,
        publicationName: fallback.publicationName ?? null
      });
    }
  } catch (err) {
    _logger.default.warn('[track-actions] member retention failed', {
      articleId: id,
      error: String(err)
    });
  }
}

/**
 * Drop one member from a followed story at the reader's request, and release its
 * retention.
 *
 * Order matters: `removeMemberSnapshot` first, release second. The release asks
 * whether any active story still holds the article, and that question reads the
 * SNAPSHOTS — releasing first would still see the article as a member and
 * decline every time. For the same reason a FAILED removal skips the release.
 *
 * Returns false when the snapshot removal failed, so the timeline can put back
 * the card it removed optimistically. The release never fails the result: a
 * retention row left behind is harmless and `deleteOrphanedRetention` (the
 * daily data-cleanup sweep) removes it.
 */
async function disownStoryMemberLocal(trackedStoryId, articleId) {
  const removed = await (0, _trackedStoryService.removeMemberSnapshot)(trackedStoryId, articleId);
  if (!removed) return false;
  await (0, _savedArticleSuggestionService.releaseTrackedStoryRetention)(articleId);
  return true;
}
const disownStoryMember = exports.disownStoryMember = (0, _command.command)('disownStoryMember', disownStoryMemberLocal);

/**
 * DELETE a followed story by id — the destructive path behind every "delete this
 * story" confirm (the story timeline's Delete button, the Stories list's trash).
 *
 * Retiring the minted TOPIC is the half that is easy to forget and expensive to
 * miss: the topic is what keeps pulling this story's articles every fetch cycle,
 * so deleting only the `tracked_stories` row leaves an invisible topic
 * retrieving coverage for a story the user believes they removed. Retire, not
 * hard-delete, mirrors how chat retires a topic (dedup/history preserved).
 *
 * Never throws. Returns true when the story row is gone afterwards, false when
 * the row delete failed; the screens stay and say so on false rather than
 * leaving a story that still exists. A failed topic retire does NOT block the
 * row delete (owner decision) and does not change the result: it is reported
 * to Sentry instead, because nothing on screen would ever reveal it.
 * Retention release failures never change the result either (see
 * {@link disownStoryMember}).
 */
async function deleteTrackedStoryByIdLocal(id) {
  if (!id) return true;
  let memberIds = [];
  let topicRetiredWithRow = false;
  try {
    const row = await (0, _trackedStoryService.getTrackedStoryById)(id);
    // Read the members BEFORE the row goes: the release below asks whether any
    // active story still holds each article, so it needs the list from a row
    // that no longer exists to know what to ask about.
    memberIds = (row?.memberSnapshots ?? []).map(s => s.articleId);
    const topicId = row?.topicId ?? null;
    // One write for both, so a failure cannot leave the topic active with no story row.
    if (topicId && (await (0, _trackedStoryService.untrackAndRetireTopic)(id, topicId))) topicRetiredWithRow = true;else if (topicId) await (0, _topicService.retire)(topicId);
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        module: 'track-actions',
        method: 'deleteTrackedStoryById.retire'
      }
    });
  }
  const deleted = topicRetiredWithRow || (await (0, _trackedStoryService.untrackStory)(id));
  if (!deleted) return false;
  // Release after the row is gone, and one at a time rather than in parallel:
  // each release re-checks every OTHER active story, so an article still
  // followed elsewhere (or still fact-checked) keeps its retention.
  // Bounded by MAX_MEMBER_SNAPSHOTS.
  for (const articleId of memberIds) {
    await (0, _savedArticleSuggestionService.releaseTrackedStoryRetention)(articleId);
  }
  return true;
}
const deleteTrackedStoryById = exports.deleteTrackedStoryById = (0, _command.command)('deleteTrackedStoryById', deleteTrackedStoryByIdLocal);

/** Is the story described by `subject` already followed (active only)? */
async function isSubjectTracked(subject) {
  return (0, _trackedStoryService.isTracked)({
    stableClusterId: subject.stableClusterId ?? null,
    articleId: subject.articleId
  });
}

/** Reactive id of the active story matching `subject` (null when untracked) —
 *  what the track BUTTON subscribes to. Reactive so it reflects a follow
 *  confirmed later inside the floating chat (which outlives the host screen)
 *  instead of staying stale until a remount; the ID rather than a flag so the
 *  "already following" dialog can navigate straight to that story. */
function observeSubjectTrackedId(subject) {
  return (0, _trackedStoryService.observeTrackedId)({
    stableClusterId: subject.stableClusterId ?? null,
    articleId: subject.articleId
  });
}

/** Settings key guarding the one-shot retention backfill below. */
const RETENTION_BACKFILL_KEY = 'tracked_story_retention_backfilled';

/**
 * ONE-SHOT: retain the members of stories that were already followed before
 * retention existed.
 *
 * Those stories have members with no retention row, and for any member the
 * server has already dropped there is nothing left to retain — that coverage is
 * gone from both sides and cannot be recovered. What this DOES rescue is every
 * member whose `article_suggestions` row is still inside its 48h window, which
 * is the whole recent tail of every followed story.
 *
 * Guarded by a settings flag rather than re-run each sync: unlike
 * `migrateLegacyTrackedStories` this is not a cheap no-op once complete — it
 * would re-read every member of every story on every cycle forever.
 *
 * Returns how many members it retained. Never throws.
 */
async function backfillTrackedStoryRetention() {
  try {
    if (await (0, _settingService.getSetting)(RETENTION_BACKFILL_KEY)) return 0;
    const ids = await (0, _trackedStoryService.listTrackedMemberArticleIds)();
    let count = 0;
    // One-shot, off the UI path, bounded by MAX_MEMBER_SNAPSHOTS per story.
    for (const articleId of ids) {
      const suggestion = await (0, _articleSuggestionReads.getSuggestionByArticleId)(articleId);
      if (!suggestion) continue; // already past the 48h prune — unrecoverable
      await (0, _savedArticleSuggestionService.keepArticleForTrackedStory)({
        articleId,
        suggestion
      });
      count += 1;
    }
    // Stamp only on a clean pass. A throw leaves the flag unset so the next
    // sync retries rather than silently skipping the backfill forever.
    await (0, _settingService.setSetting)(RETENTION_BACKFILL_KEY, String(Date.now()));
    return count;
  } catch (err) {
    _logger.default.warn('[track-actions] retention backfill failed', {
      error: String(err)
    });
    return 0;
  }
}

/**
 * One-shot, idempotent upgrade of legacy stable-cluster follows to the topic
 * model. Before the redesign a follow tracked a server `stableClusterId` archive
 * (now removed). Convert every active story that still lacks a `topic_id` into a
 * tracked TOPIC by LLM-generating a `{label, search}` scope from the story's
 * known titles — the `search` query is minted as the tracked topic and the
 * `label` becomes the story's display headline — so it keeps updating via the
 * persona query like any other topic.
 *
 * Routes through the on-device InferenceQueue exactly like the story_headline
 * flow: in CLOUD processing mode the migrate handler runs inline per row; in
 * ON-DEVICE mode a deduped inference job is enqueued per row (the queue
 * serializes llama.rn access). Rows that already have a `topic_id` are skipped,
 * so this is safe to run on every sync — a cheap no-op once nothing legacy
 * remains. Returns the count migrated (cloud) or enqueued (on-device). Never
 * throws.
 */
async function migrateLegacyTrackedStories() {
  const legacy = await (0, _trackedStoryService.getLegacyTrackedForMigration)();
  if (legacy.length === 0) return 0;
  const useCloud = _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.Cloud;
  let count = 0;
  let enqueued = 0;
  for (const row of legacy) {
    try {
      if (useCloud) {
        // Cloud: run the handler inline (one E2EE completion per story).
        const result = await (0, _trackedStoryMigrateHandler.handleTrackedStoryMigrateJob)({
          trackedStoryId: row.id,
          titles: row.titles,
          useCloud: true
        });
        if (result.ok) count++;
      } else {
        // On-device: enqueue a single deduped job (queue owns llama.rn access).
        if (await (0, _inferenceJobService.hasPendingJob)('tracked_story_migrate', 'trackedStoryId', row.id)) {
          continue;
        }
        const payload = {
          trackedStoryId: row.id,
          titles: row.titles
        };
        await (0, _inferenceJobService.enqueueJob)('tracked_story_migrate', payload);
        enqueued++;
        count++;
      }
    } catch (err) {
      _logger.default.warn('[track-actions] legacy tracked-story migrate failed', {
        id: row.id,
        error: String(err)
      });
    }
  }
  if (!useCloud && enqueued > 0) _InferenceQueue.inferenceQueue.notify();
  return count;
}