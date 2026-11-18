"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.runSubscriptionReadStage = runSubscriptionReadStage;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../database/index"));
var _subscribedSiblingService = require("../database/services/subscribed-sibling-service");
var _userPublicationSubscriptionService = require("../database/services/user-publication-subscription-service");
var _graphqlTypes = require("../generated/graphql-types");
var _jobDefer = require("../inference/job-defer");
var _logger = _interopRequireDefault(require("../logger"));
var _prompt = require("../news-harness/on-device/subscription-read/prompt");
var _parse = require("../news-harness/on-device/subscription-read/parse");
var _prompt2 = require("../news-harness/subscription-read/prompt");
var _meraProtocolStore = require("../stores/mera-protocol-store");
var _stageScoring = require("./stage-scoring");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/**
 * Post-scoring pass: a short read of how a publication the user PAYS FOR
 * covered each freshly scored story.
 *
 * Runs after `processAllUnscored()` because it needs scored rows, and it is
 * deliberately a separate stage rather than a step inside scoring: it is
 * optional work that most users generate none of, and a failure here must
 * never cost a sync its scores.
 */

const suggestionsCollection = _index.default.get('article_suggestions');

/** Cap per run. This is background polish, not the reason the sync exists. */
const MAX_READS_PER_RUN = 10;
function buildPrompt(sibling, anchorTitle) {
  const lines = [`The reader is looking at this story: ${anchorTitle ?? '(untitled)'}`, '', `Their subscribed outlet: ${sibling.publicationName ?? '(unknown)'}`, `Its headline: ${sibling.titleEn ?? sibling.titleOriginal ?? '(untitled)'}`];
  if (sibling.descriptionEn) lines.push(`Its description: ${sibling.descriptionEn}`);
  if (sibling.category) lines.push(`Category: ${sibling.category}`);
  if (sibling.eventType) lines.push(`Event type: ${sibling.eventType}`);
  return lines.join('\n');
}

/** The on-device prompt (news-harness/on-device/subscription-read) for the same fields. */
function onDevicePrompt(sibling, anchorTitle) {
  const {
    system,
    prompt
  } = (0, _prompt.buildSubscriptionReadPrompt)({
    anchorTitle,
    publicationName: sibling.publicationName ?? null,
    title: sibling.titleEn ?? sibling.titleOriginal ?? null,
    description: sibling.descriptionEn ?? null,
    category: sibling.category ?? null,
    eventType: sibling.eventType ?? null
  });
  return {
    systemPrompt: system,
    prompt
  };
}

/**
 * Rows eligible for a read: scored, and not already carrying one.
 *
 * `subscription_read_at` is the marker rather than `subscription_read`,
 * because a run that legitimately produced nothing (the model said SKIP) must
 * not be retried forever. Both are stamped together.
 */
async function candidatesForRead(limit) {
  const rows = await suggestionsCollection.query(_watermelondb.Q.where('subscription_read_at', null), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc)).fetch();
  // Mirrored in JS so the result does not depend on the query engine, matching
  // the house convention in article-suggestion-reads.
  return rows.filter(r => r.subscriptionReadAt == null).slice(0, limit);
}

/**
 * Generates subscription reads for recently scored rows.
 *
 * Returns the number of reads written. Never throws: this is background
 * polish on the sync path, and a failure here must not fail the sync.
 */
async function runSubscriptionReadStage(maxReads = MAX_READS_PER_RUN) {
  try {
    // Cheapest possible exit for the overwhelmingly common case: the user has
    // no subscriptions, so there is nothing to compare against and we never
    // touch the suggestions table at all.
    const subscribedNames = await (0, _userPublicationSubscriptionService.getSubscribedSourceNameSet)();
    if (subscribedNames.size === 0) return 0;
    const candidates = await candidatesForRead(maxReads);
    if (candidates.length === 0) return 0;
    const llm = (0, _stageScoring.getScoringLlmPort)();
    const onDevice = _meraProtocolStore.useMeraProtocolStore.getState().processingMode === _graphqlTypes.ProcessingMode.OnDevice;
    let written = 0;
    for (const anchor of candidates) {
      try {
        const sibling = await (0, _subscribedSiblingService.findPrimarySubscribedSibling)(anchor, subscribedNames);
        if (!sibling) continue;
        if (onDevice) {
          // Its own prompt, and a reader that also takes the SKIP a small
          // model dresses up ("SKIP.", quoted, fenced). Stamped like any other.
          const {
            systemPrompt,
            prompt
          } = onDevicePrompt(sibling, anchor.titleEn ?? anchor.titleOriginal);
          const stored = (0, _parse.parseSubscriptionRead)(await llm.complete({
            systemPrompt,
            prompt,
            maxTokens: 160,
            temperature: 0
          }));
          await (0, _subscribedSiblingService.saveSubscriptionRead)(anchor.id, stored);
          if (stored) written += 1;
          continue;
        }
        const raw = await llm.complete({
          systemPrompt: _prompt2.SUBSCRIPTION_READ_SYSTEM_PROMPT,
          prompt: buildPrompt(sibling, anchor.titleEn ?? anchor.titleOriginal),
          maxTokens: 160,
          temperature: 0
        });
        const read = (raw ?? '').trim();
        // A SKIP is a real answer, and it is stamped like any other so the row
        // is not re-asked on every sync for the rest of its 48 hours.
        const stored = !read || read === 'SKIP' ? '' : read;
        await (0, _subscribedSiblingService.saveSubscriptionRead)(anchor.id, stored);
        if (stored) written += 1;
      } catch (error) {
        // The built-in model is busy or gone: every next row would fail the
        // same way. Stop; the rest stay unread for the next sync.
        if (onDevice && (0, _jobDefer.isOnDeviceDeferrable)(error)) break;
        _logger.default.warn('[subscription-read] one row failed, continuing', {
          suggestionId: anchor.id,
          error: String(error)
        });
      }
    }
    return written;
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'stage-subscription-read',
        method: 'runSubscriptionReadStage'
      }
    });
    return 0;
  }
}