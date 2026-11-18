"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MAX_CHECKS_PER_SWEEP = void 0;
exports.runFollowInsteadSweep = runFollowInsteadSweep;
var _watermelondb = require("@nozbe/watermelondb");
var _cloudComplete = require("../../llm/cloudComplete");
var _onDeviceGate = require("../../llm/on-device-gate");
var _logger = _interopRequireDefault(require("../../logger"));
var _meraHarness = require("../../mera-harness");
var _followStory = require("../../news-harness/follow-story");
var _factHygiene = require("../../news-harness/persona-management/fact-hygiene");
var _stakeCheck = require("../../news-harness/persona-management/stake-check");
var _factRowsSelector = require("../../stores/fact-rows-selector");
var _articleSuggestionStatus = require("../article-suggestion-status");
var _index = _interopRequireDefault(require("../index"));
var _articleSuggestionMappers = require("./article-suggestion-mappers");
var _factService = require("./fact-service");
var _hygieneService = require("./hygiene-service");
var _settingService = require("./setting-service");
var _storyImpressionService = require("./story-impression-service");
var _topicService = require("./topic-service");
var _trackedStoryService = require("./tracked-story-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The daily follow-instead offer, RN adapter for the pure detector in
// fact-hygiene.ts. It runs inside `persona-geo-task` and adds no job, table or
// counter: it reads rows the product keeps to operate (matches on
// article_suggestions, opens on story_impressions, which ranking already reads),
// nothing leaves the phone but the fact to the AI check, and the result only
// proposes. Accepting lives in hygiene-service with the other accepts.

const LAST_SWEEP_KEY = 'follow_instead_last_sweep_at';

/** At most one offer a day. The task's own cadence is not this bound: a foreground
 *  can run it sooner, and a dismissal empties the queue the same day. */
const SWEEP_GAP_MS = 24 * 60 * 60 * 1000;

/** A persona full of real stakes costs this many small calls a day, no more. */
const MAX_CHECKS_PER_SWEEP = exports.MAX_CHECKS_PER_SWEEP = 3;
const VERDICTLESS = new Set([_articleSuggestionStatus.ArticleSuggestionStatus.Unscored, _articleSuggestionStatus.ArticleSuggestionStatus.Excluded, _articleSuggestionStatus.ArticleSuggestionStatus.AlreadyRead]);
async function readRows(now) {
  const cutoff = now - _factRowsSelector.FEED_WINDOW_MS;
  const [rows, impressions] = await Promise.all([_index.default.get('article_suggestions').query(_watermelondb.Q.where('first_pub_date', _watermelondb.Q.gte(cutoff))).fetch(), (0, _storyImpressionService.getAll)()]);
  // Impressions live 30 days; only an open from this window speaks for these rows.
  const opened = new Set(impressions.filter(i => i.opened && i.firstSeenAt.getTime() >= cutoff).map(i => i.articleId));
  return rows.map(r => ({
    storyKey: r.storyKey ?? r.id,
    topicIds: (0, _articleSuggestionMappers.parseMatchedTopicRefs)(r.matchedTopicsJson).flatMap(t => t.topicId ? [t.topicId] : []),
    opened: opened.has(r.id),
    alreadyRead: r.status === _articleSuggestionStatus.ArticleSuggestionStatus.AlreadyRead,
    judged: !VERDICTLESS.has(r.status) && (r.relevance > 0 || r.scoredAt != null),
    passedGate: (0, _factRowsSelector.relevancePassesGate)({
      scoredWithV3: r.scoredWithV3 === true,
      relevance: r.relevance
    })
  }));
}
async function findCandidates(now, rejected) {
  const [facts, topics, stories, rows] = await Promise.all([(0, _factService.getFacts)(), (0, _topicService.getAllTopicSnapshots)(), (0, _trackedStoryService.getActiveForTopicReconcile)(), readRows(now)]);
  return (0, _factHygiene.detectFollowInstead)({
    facts: facts.map(f => ({
      id: f.id,
      statement: f.statement,
      questionnaireAttribute: f.questionnaireAttribute,
      isInterest: (0, _meraHarness.topicSkillForAttribute)(f.questionnaireAttribute) === 'topics/interest',
      newsStopped: (0, _factService.isNewsStopped)(f)
    })),
    topics,
    rows,
    storyBoundTopicIds: stories.map(s => s.topicId),
    rejectedFingerprints: rejected
  });
}

/** What the story is called and searched by, or null when the check found no way
 *  to follow it. A fact's subject comes from the check, because a fact is a phrase
 *  about the reader; a topic is already a search. */
function followOf(c, check) {
  if (check.hasStake) return null;
  if (c.trigger === 'flood') return {
    label: (0, _stakeCheck.capitalised)(c.subject),
    searchText: c.subject
  };
  return check.subject ? {
    label: check.subject,
    searchText: check.search ?? check.subject
  } : null;
}

/** Find one candidate worth offering, ask the AI check, publish at most one. Never throws. */
async function runFollowInsteadSweep(opts) {
  const now = opts?.now ?? Date.now();
  try {
    if (await (0, _onDeviceGate.isOnDeviceMode)()) return {
      offered: null,
      reason: 'on_device'
    };
    const last = Number(await (0, _settingService.getSetting)(LAST_SWEEP_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < SWEEP_GAP_MS) return {
      offered: null,
      reason: 'cooldown'
    };
    const {
      rejected,
      offerWaiting
    } = await (0, _hygieneService.getFollowInsteadState)();
    if (offerWaiting) return {
      offered: null,
      reason: 'waiting'
    };
    const candidates = await findCandidates(now, rejected);
    let offered = null;
    for (const c of candidates.slice(0, MAX_CHECKS_PER_SWEEP)) {
      const raw = await (0, _cloudComplete.cloudComplete)({
        ...(0, _stakeCheck.stakeCheckRequest)(c.statement),
        ..._stakeCheck.STAKE_CHECK_CALL
      });
      const follow = followOf(c, (0, _stakeCheck.decodeStakeCheck)(raw, c.statement));
      if (!follow) continue;
      const subject = {
        ...(0, _followStory.makeFollowStorySubject)(),
        surface: 'follow-instead'
      };
      await (0, _hygieneService.addFollowInsteadProposal)((0, _factHygiene.followInsteadProposal)(c, follow, subject));
      offered = c.id;
      break;
    }
    await (0, _settingService.setSetting)(LAST_SWEEP_KEY, String(now));
    return {
      offered
    };
  } catch (error) {
    // Stamps nothing: like the geo sweep, a failed call is asked again next run.
    _logger.default.warn('[follow-instead] sweep failed', {
      error: String(error)
    });
    return {
      offered: null,
      reason: 'check_failed'
    };
  }
}