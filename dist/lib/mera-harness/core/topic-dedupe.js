"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.filterNearDuplicates = filterNearDuplicates;
var _topicSimilarity = require("./topic-similarity");
// mera-harness/core — within-set near-duplicate filter. PURE, RN-free.
//
// Ships ON. The skill text is the first line of defence; this is the
// deterministic fallback behind it, and an arm switches it off for measurement
// (the switch lives at the CALL SITE, so this function has exactly one
// behaviour and the eval can apply it offline to collected output).

/**
 * Drop a topic whose content-word Jaccard with an EARLIER KEPT topic is
 * >= FILTER_DROP_JACCARD (0.75).
 *
 * Earlier-kept, not pairwise-any, so the first occurrence always survives and
 * the output is order-deterministic.
 *
 * NEVER a subset rule. A ladder deliberately emits rungs that contain each
 * other, so dropping a topic because its tokens are a subset of a sibling's
 * kills exactly the structure the skill bodies exist to produce. The eval
 * scorer flags subsets; this filter does not act on them, and that gap is
 * deliberate (see topic-similarity.ts).
 *
 * Fails OPEN: anything it cannot judge comes back whole.
 */
function filterNearDuplicates(topics) {
  const kept = [];
  const dropped = [];
  for (const topic of topics) {
    const text = (topic ?? '').trim();
    if (!text) continue;
    let collidedWith = null;
    for (const earlier of kept) {
      if ((0, _topicSimilarity.contentJaccard)(text, earlier) >= _topicSimilarity.FILTER_DROP_JACCARD) {
        collidedWith = earlier;
        break;
      }
    }
    if (collidedWith) {
      dropped.push({
        topic: text,
        duplicateOf: collidedWith,
        overlap: (0, _topicSimilarity.sharedTokens)(text, collidedWith)
      });
    } else {
      kept.push(text);
    }
  }
  return {
    kept,
    dropped
  };
}