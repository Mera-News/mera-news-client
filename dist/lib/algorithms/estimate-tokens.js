"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.estimateTokens = estimateTokens;
// Shared token estimation for both local (llama.rn) and cloud LLM paths.
// Used for input-size logging and on-device budget enforcement.

/**
 * Estimates token count for a string.
 * CJK characters tokenize at ~1.2 chars/token; Latin/other text at ~4 chars/token.
 */
function estimateTokens(text) {
  const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;
  const cjkMatches = text.match(cjkPattern);
  const cjkCount = cjkMatches?.length ?? 0;
  const nonCjkCount = text.length - cjkCount;
  return Math.ceil(cjkCount / 1.2) + Math.ceil(nonCjkCount / 4);
}