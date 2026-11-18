"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.assemblePersonaSummaryStrings = assemblePersonaSummaryStrings;
var _config = require("./config");
// news-harness — persona-summary assembler (PURE, RN-free).

function unique(xs) {
  return Array.from(new Set(xs));
}

/**
 * Resolve drafts into storable results: map each draft's 1-based fact refs to
 * real fact ids (via the SAME ordered list passed to the prompt), union the
 * linked facts' topic ids, drop over-long or duplicate lines, and cap the
 * count. A draft with no valid refs is kept (it renders, but its sheet actions
 * that need a linked fact/topic are disabled).
 */
function assemblePersonaSummaryStrings(drafts, selected) {
  const results = [];
  const seen = new Set();
  for (const draft of drafts) {
    const text = draft.text.trim();
    if (!text || text.length > _config.MAX_STRING_CHARS) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    const factIds = [];
    const topicIds = [];
    for (const ref of draft.factRefs) {
      const fact = selected[ref - 1];
      if (!fact) continue;
      factIds.push(fact.factId);
      topicIds.push(...fact.topicIds);
    }
    seen.add(key);
    results.push({
      text,
      linkedFactIds: unique(factIds),
      linkedTopicIds: unique(topicIds)
    });
    if (results.length >= _config.MAX_SUMMARY_STRINGS) break;
  }
  return results;
}