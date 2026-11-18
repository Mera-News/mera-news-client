"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.generateTopicsForFact = generateTopicsForFact;
var _completeLocal = require("../llm/completeLocal");
var _prompt = require("../news-harness/on-device/topic-gen/prompt");
var _shared = require("../news-harness/on-device/shared");
var _onDeviceModel = require("../platform/on-device-model");
var _schema = require("../news-harness/on-device/topic-gen/schema");
var _parse = require("../news-harness/on-device/topic-gen/parse");
var _config = require("../news-harness/core/config");
// Topic Generation Service — on-device topic generation for a single fact.
//
// One structured call per fact through the on-device text engine, with the
// on-device prompt and schema (lib/news-harness/on-device/topic-gen). Fact
// only: on-device has no combination pass (owner decision), so the topic_gen
// handler sends no other facts and none are read here. Cloud topics come from
// the skill core (topic-gen-handler → lib/mera-harness).

// Re-export moved pure helpers (canonical home is the harness).

// SOURCED from the harness config, never re-stated: this is what "Generate more
// topics" calls, and `topicPlan.generateMoreTopicsWarning` promises the user
// the same number.
const DEFAULT_TOTAL_LOCAL = _config.DEFAULT_HARNESS_CONFIG.topicGen.totalLocal;

/**
 * Output budget for the on-device call (1024 = the on-device max-output
 * ceiling). Thinking is off, so the ~55-100 token answer is the whole cost;
 * larger counts raise it at 30 tokens a topic.
 */
const LOCAL_TOPIC_GEN_MAX_TOKENS = 1024;

/**
 * Topics for ONE fact on the on-device engine, used by the topic_gen handler's
 * local branch. Every failure reaches the handler: busy or unavailable defers
 * the job, and anything else (a refusal, a reply that never fit the schema) is an
 * error, never an empty answer, or it would count toward removing the fact.
 */
async function generateTopicsForFact(inputs) {
  const count = inputs.totalCount ?? DEFAULT_TOTAL_LOCAL;
  const schema = (0, _schema.topicGenSchema)(count);
  const maxTokens = Math.max(LOCAL_TOPIC_GEN_MAX_TOKENS, count * 30);
  // Sized to the engine's input: Gemini Nano refuses an oversized prompt, and
  // that refusal is not deferrable, so a long exclusion list would fail the
  // fact on every retry.
  const engine = await (0, _onDeviceModel.getTextEngine)();
  const budget = (0, _shared.promptBudgetTokens)({
    contextSize: await (0, _onDeviceModel.contextSize)(engine),
    maxTokens,
    system: _prompt.TOPIC_GEN_SYSTEM,
    schemaJson: JSON.stringify(schema)
  });
  const {
    system,
    prompt
  } = (0, _prompt.buildTopicGenPrompt)(inputs, count, budget);
  const reply = await (0, _completeLocal.completeLocalStructured)({
    systemPrompt: system,
    prompt,
    schema,
    maxTokens,
    temperature: 0.3,
    engine
  });
  return (0, _parse.topicsFromReply)(reply);
}