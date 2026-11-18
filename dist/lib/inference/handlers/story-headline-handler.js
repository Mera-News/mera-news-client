"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.handleStoryHeadlineJob = handleStoryHeadlineJob;
exports.storyHeadlineDedupeKey = storyHeadlineDedupeKey;
var _trackedStoryService = require("../../database/services/tracked-story-service");
var _cloudComplete = require("../../llm/cloudComplete");
var _onDeviceGate = require("../../llm/on-device-gate");
var _completeLocal = require("../../llm/completeLocal");
var _prompt = require("../../news-harness/story-headline/prompt");
var _parser = require("../../news-harness/story-headline/parser");
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Handler for story_headline jobs — turns the titles of a tracked story's member
// articles into ONE plain-language English headline and writes it to the
// story's `llm_headline`. Cloud path = one E2EE completion; on-device path = one
// local completion. Mirrors the persona-summary handler's shape (input → LLM →
// strict JSON → write) and reuses the queue's retry mechanics. Non-destructive:
// any transport/parse failure leaves the existing `fallback_title` in place.

/**
 * Stable dedupe key so a later enqueue can avoid stacking duplicate
 * headline jobs for the same story: `story_headline:<trackedStoryId>`.
 */
function storyHeadlineDedupeKey(trackedStoryId) {
  return `story_headline:${trackedStoryId}`;
}
async function handleStoryHeadlineJob(payload) {
  const trackedStoryId = payload.trackedStoryId;
  const titles = Array.isArray(payload.titles) ? payload.titles : [];
  if (!trackedStoryId || titles.length === 0) {
    _logger.default.warn('[story-headline] invalid payload — skipping', {
      trackedStoryId,
      titleCount: titles.length
    });
    return {
      ok: false
    };
  }
  const {
    system,
    user
  } = (0, _prompt.buildStoryHeadlinePrompt)(titles);
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
      raw = await (0, _completeLocal.completeLocal)({
        systemPrompt: system,
        prompt: user,
        maxTokens: 128,
        temperature: 0.3,
        responseFormat: 'json',
        enableThinking: false
      });
    }
  } catch (err) {
    // Transport failure — keep the fallback title (no write).
    _logger.default.warn('[story-headline] completion failed', {
      error: String(err)
    });
    return {
      ok: false
    };
  }
  let headline;
  try {
    headline = (0, _parser.parseStoryHeadlineOutput)(raw);
  } catch (err) {
    // Model produced non-JSON garbage — keep the fallback title.
    _logger.default.warn('[story-headline] parse failed', {
      error: String(err)
    });
    return {
      ok: false
    };
  }
  await (0, _trackedStoryService.setLlmHeadline)(trackedStoryId, headline);
  _logger.default.debug('[story-headline] wrote headline', {
    trackedStoryId
  });
  return {
    ok: true
  };
}