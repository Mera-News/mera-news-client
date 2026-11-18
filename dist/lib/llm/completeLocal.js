"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.completeLocal = completeLocal;
exports.completeLocalStructured = completeLocalStructured;
var _onDeviceModel = require("../platform/on-device-model");
// completeLocal: standalone local LLM completion on the phone's built-in model
// (Apple Intelligence, Gemini Nano). Calls infer() from mera-protocol-toolkit.
// The built-in models emit no reasoning trace and never report a truncated
// reply, so the reply is the answer.

async function completeLocal(request) {
  const result = await (0, _onDeviceModel.infer)({
    systemPrompt: request.systemPrompt,
    prompt: request.prompt,
    maxTokens: request.maxTokens ?? 512,
    temperature: request.temperature ?? 0.3,
    responseFormat: request.responseFormat === 'json' ? 'json' : undefined,
    label: request.label,
    engine: request.engine
  });
  return result.output.trim();
}
/**
 * A JSON value fitting `schema`, from the on-device text engine: the entry point
 * for every on-device flow that needs structured output. Throws
 * StructuredOutputError when no reply fits after one retry, and passes engine
 * errors (busy, unavailable) through untouched so a queue job can defer.
 */
function completeLocalStructured(request) {
  return (0, _onDeviceModel.inferStructured)({
    system: request.systemPrompt,
    prompt: request.prompt,
    schema: request.schema,
    maxTokens: request.maxTokens ?? 512,
    temperature: request.temperature ?? 0.3,
    label: request.label,
    engine: request.engine
  });
}