"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TOPIC_SIGNAL_SINCE_KEY = void 0;
exports.readTopicSignalSince = readTopicSignalSince;
exports.stampTopicSignalsFromFeed = stampTopicSignalsFromFeed;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _articleSuggestionStatus = require("../article-suggestion-status");
var _factRowsSelector = require("../../stores/fact-rows-selector");
var _factHygiene = require("../../news-harness/persona-management/fact-hygiene");
var _platform = require("../../platform");
var _topicService = require("./topic-service");
var _settingService = require("./setting-service");
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Topic signals: when did one of a fact-made topic's rows last reach the Feed?
//
// The answer feeds the stale_topic proposal (fact-hygiene), which offers to
// remove a topic that has brought nothing for weeks. It is read off the stored
// rows rather than at score time, so it needs no hook in any scoring path: data
// cleanup stamps right before the 48h sweep deletes rows, and the hygiene sweep
// stamps before it looks, so every row that reached the Feed is seen once.

/** When stamping began on this device. Idle time is never counted from before it. */
const TOPIC_SIGNAL_SINCE_KEY = exports.TOPIC_SIGNAL_SINCE_KEY = 'topic_signal_since';

/** The matched topic texts of a stored row, minus the synthetic headline entries. */
function matchedTexts(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(m => m && typeof m.topicId === 'string' && typeof m.text === 'string').map(m => (0, _topicService.normalizeTopicText)(m.text)).filter(t => t.length > 0);
  } catch {
    return [];
  }
}

/**
 * Stamp every fact-made topic whose text matched a row that reached the Feed
 * (relevance at the render gate or above, status complete) with that row's
 * time. Writes the start-of-stamping marker on first use. Skipped on a phone
 * paired with a server, which keeps its own topics. Never throws.
 */
async function stampTopicSignalsFromFeed(nowMs = Date.now()) {
  try {
    if ((0, _platform.platform)('lib/database/services/topic-signal-service').podCommand) return 0;
    if (!(await (0, _settingService.getSetting)(TOPIC_SIGNAL_SINCE_KEY))) {
      await (0, _settingService.setSetting)(TOPIC_SIGNAL_SINCE_KEY, String(nowMs));
    }
    const rows = await _index.default.get('article_suggestions').query(_watermelondb.Q.where('relevance', _watermelondb.Q.gte(_factRowsSelector.RENDER_GATE)), _watermelondb.Q.where('status', _articleSuggestionStatus.ArticleSuggestionStatus.Complete)).fetch();
    const latestByText = new Map();
    for (const row of rows) {
      if (row.relevance < _factRowsSelector.RENDER_GATE || row.status !== _articleSuggestionStatus.ArticleSuggestionStatus.Complete) continue;
      const at = row.scoredAt ?? (row.createdAt instanceof Date ? row.createdAt.getTime() : nowMs);
      for (const text of matchedTexts(row.matchedTopicsJson)) {
        if ((latestByText.get(text) ?? 0) < at) latestByText.set(text, at);
      }
    }
    return await (0, _topicService.stampTopicSignals)(latestByText, _factHygiene.FACT_MADE_PROVENANCES);
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'topic-signal-service',
        method: 'stampTopicSignalsFromFeed'
      }
    });
    return 0;
  }
}

/** The start-of-stamping marker, or null before the first stamp run. */
async function readTopicSignalSince() {
  const raw = Number(await (0, _settingService.getSetting)(TOPIC_SIGNAL_SINCE_KEY).catch(() => null));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}