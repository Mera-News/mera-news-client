"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.handleTrackedStoryMigrateJob = handleTrackedStoryMigrateJob;
exports.trackedStoryMigrateDedupeKey = trackedStoryMigrateDedupeKey;
var _topicService = require("../../database/services/topic-service");
var _trackedStoryService = require("../../database/services/tracked-story-service");
var _cloudComplete = require("../../llm/cloudComplete");
var _onDeviceGate = require("../../llm/on-device-gate");
var _completeLocal = require("../../llm/completeLocal");
var _jobDefer = require("../job-defer");
var _storyScope = require("../../news-harness/story-scope");
var _prompt = require("../../news-harness/on-device/story-scope/prompt");
var _schema = require("../../news-harness/on-device/story-scope/schema");
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Handler for tracked_story_migrate jobs — converts a LEGACY stable-cluster
// follow (a `tracked_stories` row with no `topic_id`) into a topic-linked story.
// It LLM-generates a `{label, search}` scope from the story's known titles, mints
// a tracked TOPIC from the `search` query, binds it onto the story, and writes the
// display `label` as the story's headline. Cloud path = one E2EE completion;
// on-device path = one structured local completion with its own prompt
// (news-harness/on-device/story-scope). Mirrors the story_headline handler's
// shape (titles → LLM → strict JSON → write) and reuses the queue's retry
// mechanics. Non-destructive: any transport/parse failure leaves the row
// unmigrated (still legacy) so a later run can retry.

/** Seed weight for a topic minted from a legacy follow — mirrors the interactive
 *  "Track story" weight (below a hand-pinned 1.0, high enough to retrieve). */
const TRACKED_TOPIC_WEIGHT = 0.85;
/**
 * Stable dedupe key so a later enqueue can avoid stacking duplicate
 * migrate jobs for the same story: `tracked_story_migrate:<trackedStoryId>`.
 */
function trackedStoryMigrateDedupeKey(trackedStoryId) {
  return `tracked_story_migrate:${trackedStoryId}`;
}
async function handleTrackedStoryMigrateJob(payload) {
  const trackedStoryId = payload.trackedStoryId;
  const titles = Array.isArray(payload.titles) ? payload.titles : [];
  if (!trackedStoryId || titles.length === 0) {
    _logger.default.warn('[tracked-story-migrate] invalid payload — skipping', {
      trackedStoryId,
      titleCount: titles.length
    });
    return {
      ok: false
    };
  }

  // Real clock supplied HERE — buildStoryScopePrompt takes the date as a
  // parameter so its prompt stays deterministic/pinnable.
  const {
    system,
    user
  } = (0, _storyScope.buildStoryScopePrompt)(titles, Date.now());
  let raw = '';
  try {
    // A job queued in cloud mode runs locally if the mode has since changed.
    if (payload.useCloud && !(await (0, _onDeviceGate.isOnDeviceMode)())) {
      raw = await (0, _cloudComplete.cloudComplete)({
        systemPrompt: system,
        prompt: user,
        maxTokens: 128,
        temperature: 0.3
      });
    } else {
      // Its own prompt and schema; the reply goes through the same parser.
      const local = (0, _prompt.buildOnDeviceStoryScopePrompt)(titles, Date.now());
      raw = JSON.stringify(await (0, _completeLocal.completeLocalStructured)({
        systemPrompt: local.system,
        prompt: local.prompt,
        schema: _schema.STORY_SCOPE_SCHEMA,
        maxTokens: 128,
        temperature: 0.3
      }));
    }
  } catch (err) {
    // The built-in model said "not now" (busy, unavailable): the queue defers the job.
    if ((0, _jobDefer.isOnDeviceDeferrable)(err)) throw err;
    // Transport failure — leave the story unmigrated (no write).
    _logger.default.warn('[tracked-story-migrate] completion failed', {
      error: String(err)
    });
    return {
      ok: false
    };
  }
  let label;
  let search;
  try {
    ({
      label,
      search
    } = (0, _storyScope.parseStoryScopeOutput)(raw));
  } catch (err) {
    // Model produced non-JSON garbage — leave the story unmigrated.
    _logger.default.warn('[tracked-story-migrate] parse failed', {
      error: String(err)
    });
    return {
      ok: false
    };
  }

  // Mint (or resolve an existing) 'tracked' topic from the generated search
  // query, bind it onto the story, and set the display label as its headline.
  const [topic] = await (0, _topicService.createTopics)([{
    text: search,
    weight: TRACKED_TOPIC_WEIGHT,
    status: 'active',
    provenance: 'tracked',
    highPriority: true
  }]);
  await (0, _trackedStoryService.bindTrackedTopic)(trackedStoryId, topic?.id ?? null, search);
  await (0, _trackedStoryService.setLlmHeadline)(trackedStoryId, label);
  _logger.default.debug('[tracked-story-migrate] migrated legacy story', {
    trackedStoryId
  });
  return {
    ok: true
  };
}