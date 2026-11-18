"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildPersonaSummaryInputs = buildPersonaSummaryInputs;
exports.handlePersonaSummaryJob = handlePersonaSummaryJob;
var _factService = require("../../database/services/fact-service");
var _topicService = require("../../database/services/topic-service");
var _personaSummaryService = require("../../database/services/persona-summary-service");
var _cloudComplete = require("../../llm/cloudComplete");
var _onDeviceGate = require("../../llm/on-device-gate");
var _completeLocal = require("../../llm/completeLocal");
var _assemble = require("../../news-harness/persona-summary/assemble");
var _prompt = require("../../news-harness/persona-summary/prompt");
var _parser = require("../../news-harness/persona-summary/parser");
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Handler for persona_summary jobs — turns the on-device persona (facts + their
// generated topics) into 4–8 plain-language "About you" strings and writes them
// to `persona_summary_strings`. Cloud path = one E2EE completion; on-device path
// = one local completion. Mirrors the topic-gen handler's shape (persona → LLM →
// strict JSON → write table) and reuses the queue's retry mechanics.

/**
 * Assemble the LLM input from the persisted persona: every fact with its weight
 * and the ids of the active topic rows it owns. RN-coupled (reads WatermelonDB);
 * the pure selection/prompt/parse/assemble live in the harness.
 */
async function buildPersonaSummaryInputs() {
  const [facts, factSnaps, topicSnaps] = await Promise.all([(0, _factService.getFacts)(), (0, _factService.getFactSectionSnapshots)(), (0, _topicService.getActiveTopicSnapshots)()]);
  const weightById = new Map(factSnaps.map(s => [s.id, s.weight ?? 1]));
  const topicsByFact = new Map();
  for (const t of topicSnaps) {
    if (!t.factId) continue;
    const arr = topicsByFact.get(t.factId);
    if (arr) arr.push(t.id);else topicsByFact.set(t.factId, [t.id]);
  }
  return facts.map(f => ({
    factId: f.id,
    statement: f.statement,
    weight: weightById.get(f.id) ?? 1,
    topicIds: topicsByFact.get(f.id) ?? []
  }));
}
async function handlePersonaSummaryJob(payload) {
  const personaVersion = payload.personaVersion ?? null;
  const inputs = await buildPersonaSummaryInputs();

  // Empty persona → clear any stale strings so the empty-state CTA shows.
  if (inputs.length === 0) {
    await (0, _personaSummaryService.replaceAllSummaryStrings)([], personaVersion);
    return {
      count: 0
    };
  }
  const selected = (0, _prompt.selectFactsForSummary)(inputs);
  const {
    system,
    user
  } = (0, _prompt.buildPersonaSummaryPrompt)(selected);
  let raw = '';
  try {
    // A job queued in cloud mode runs locally if the mode has since changed.
    if (payload.useCloud && !(await (0, _onDeviceGate.isOnDeviceMode)())) {
      raw = await (0, _cloudComplete.cloudComplete)({
        systemPrompt: system,
        prompt: user,
        maxTokens: 512,
        temperature: 0.4
      });
    } else {
      raw = await (0, _completeLocal.completeLocal)({
        systemPrompt: system,
        prompt: user,
        maxTokens: 512,
        temperature: 0.4,
        responseFormat: 'json',
        enableThinking: false
      });
    }
  } catch (err) {
    // Transport failure — keep the previous strings (no wipe).
    _logger.default.warn('[persona-summary] completion failed', {
      error: String(err)
    });
    return {
      count: 0
    };
  }
  let results;
  try {
    const drafts = (0, _parser.parsePersonaSummaryOutput)(raw);
    results = (0, _assemble.assemblePersonaSummaryStrings)(drafts, selected);
  } catch (err) {
    // Model produced non-JSON garbage — keep the previous strings.
    _logger.default.warn('[persona-summary] parse failed', {
      error: String(err)
    });
    return {
      count: 0
    };
  }
  if (results.length === 0) {
    _logger.default.debug('[persona-summary] no usable strings produced; keeping previous');
    return {
      count: 0
    };
  }
  await (0, _personaSummaryService.replaceAllSummaryStrings)(results, personaVersion);
  _logger.default.debug('[persona-summary] wrote strings', {
    count: results.length
  });
  return {
    count: results.length
  };
}