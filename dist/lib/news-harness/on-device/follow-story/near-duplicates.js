"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.dropNearDuplicates = dropNearDuplicates;
exports.isNearDuplicate = isNearDuplicate;
var _topicSimilarity = require("../../../mera-harness/core/topic-similarity");
// AFM writes one story several times over ("X Expansion Plans / X Development
// Timeline / X Project Progress"), and no prompt wording stopped it, so the card
// drops near-copies in code. Pure and RN-free.

/** Words that name a facet of a story, not a story: two labels that differ only by these are one story. */
const FACET_WORDS = new Set(['update', 'updates', 'progress', 'timeline', 'plan', 'plans', 'development', 'developments', 'status', 'impact', 'impacts', 'implications', 'history', 'background', 'overview', 'analysis', 'latest', 'news', 'coverage', 'project', 'outlook', 'trends']);
const withoutFacets = label => label.split(/[^\p{L}\p{N}]+/u).filter(w => w && !FACET_WORDS.has(w.toLowerCase())).join(' ');
const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Same search, or labels whose content words, facet words left out, overlap at the eval's "too close" bar. */
function isNearDuplicate(a, b) {
  if (norm(a.search) && norm(a.search) === norm(b.search)) return true;
  return (0, _topicSimilarity.contentJaccard)(withoutFacets(a.label), withoutFacets(b.label)) >= _topicSimilarity.DETECT_JACCARD;
}

/** The options with each near-copy of an earlier one dropped. The first `protectedHead` rows (the reader's own words) always stay. */
function dropNearDuplicates(options, protectedHead = 0) {
  const kept = [];
  options.forEach((o, i) => {
    if (i < protectedHead || !kept.some(k => isNearDuplicate(k, o))) kept.push(o);
  });
  return kept;
}