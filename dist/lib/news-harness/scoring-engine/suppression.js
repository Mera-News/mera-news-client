"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildSuppressionHaystack = buildSuppressionHaystack;
exports.canHardExclude = canHardExclude;
exports.isHardFilterExempt = isHardFilterExempt;
exports.matchingHardSuppressions = matchingHardSuppressions;
exports.screenHardSuppressions = screenHardSuppressions;
exports.screenHardSuppressionsDetailed = screenHardSuppressionsDetailed;
exports.suppressionDisplayValue = suppressionDisplayValue;
exports.suppressionMatchesCandidate = suppressionMatchesCandidate;
var _personaContext = require("./persona-context");
// scoring-engine — the ONE kind-aware suppression matcher.
//
// Pure, RN-free. Both suppression paths run through here so they can never
// diverge:
//
//   - SOFT (strength < HARD_SUPPRESSION_STRENGTH) → a capped score penalty,
//     applied by relevance.ts::splitSuppressionPenalty.
//   - HARD (strength ≥ HARD_SUPPRESSION_STRENGTH) → the candidate is screened
//     OUT before any scoring work (screenHardSuppressions), invoked from both
//     orchestrator convergence points — UNLESS it is a top-headline row, which
//     the headline exemption keeps from exclusion and demotes instead (isHardFilterExempt), or
//     the filter is `entity`-kind, which may never exclude at all
//     (canHardExclude).
//
// The hard/soft partition itself happens ONCE, in the RN-side persona loader
// (mera-protocol/stage-scoring::loadPersonaScoringContext) — this module only
// matches whatever list it is handed. There is deliberately no new harness
// config constant: the threshold is a database-service concern, not a tunable
// scoring weight.
//
// BYTE-IDENTITY CONTRACT: for `keyword` (and NULL-kind, which reads as
// keyword) suppressions this module reproduces the historical matcher exactly —
// normalized substring over `title + '  ' + description + '  ' + entities`,
// with the `kk.length > 0` guard that makes a blank keyword match NOTHING
// (`haystack.includes('')` would otherwise be true for every article). A
// 1000-article corpus diff gates this; do not "simplify" the guard away.

// Type-only (erased at runtime) — keeps relevance.ts ⇄ suppression.ts free of
// a real import cycle while relevance.ts imports the matcher for real.

/** Every kind that compares against the single `value` column. Anything not in
 *  here (including a kind a NEWER build wrote) falls back to keyword. */
const STRUCTURED_KINDS = new Set(['category', 'event_type', 'entity', 'publication', 'place', 'topic']);

/**
 * The haystack the `keyword` kind matches against: normalized title,
 * description and entities joined by two spaces. Reproduced byte-for-byte from
 * the earlier inline implementation in relevance.ts.
 */
function buildSuppressionHaystack(candidate) {
  return [(0, _personaContext.normText)(candidate.titleEn ?? ''), (0, _personaContext.normText)(candidate.descriptionEn ?? ''), ...(candidate.entities ?? []).map(_personaContext.normText)].join('  ');
}

/** Historical keyword semantics: any non-empty keyword as a normalized
 *  substring of the haystack. */
function matchesKeywords(keywords, haystack) {
  if (!keywords?.length) return false;
  return keywords.some(k => {
    const kk = (0, _personaContext.normText)(k);
    return kk.length > 0 && haystack.includes(kk);
  });
}

/**
 * Does this suppression match this candidate?
 *
 * `haystack` is an optional precomputed `buildSuppressionHaystack(candidate)` —
 * pass it when screening one candidate against many suppressions.
 *
 * An empty/absent `value` on a non-keyword kind matches NOTHING (never
 * everything) — the same defensive posture as the blank-keyword guard.
 * An unknown/future `kind` falls back to keyword semantics when the row has
 * keywords, else matches nothing. This function never throws.
 */
function suppressionMatchesCandidate(candidate, s, haystack) {
  const kind = s.kind ?? 'keyword';

  // keyword (incl. NULL kind) — and any unknown/future kind, which degrades to
  // keyword semantics rather than throwing or blocking. Checked BEFORE the
  // empty-value guard so an unknown kind with keywords still matches.
  if (kind === 'keyword' || !STRUCTURED_KINDS.has(kind)) {
    return matchesKeywords(s.keywords, haystack ?? buildSuppressionHaystack(candidate));
  }
  const value = (0, _personaContext.normText)(s.value ?? '');
  if (value.length === 0) return false;
  switch (kind) {
    case 'category':
      return (0, _personaContext.normText)(candidate.category ?? '') === value;
    case 'event_type':
      return (0, _personaContext.normText)(candidate.eventType ?? '') === value;
    case 'entity':
      return (candidate.entities ?? []).some(e => (0, _personaContext.normText)(e) === value);
    case 'publication':
      return (0, _personaContext.normText)(candidate.publicationName ?? '') === value;
    case 'place':
      {
        // Only the article's GEO TAGS count. The top-level countryCode is the
        // PUBLISHING country, not what the story is about — muting "France"
        // must not kill every AFP wire story.
        //
        // AUDITED FOR THE SUPRANATIONAL PLACE CODES ("MIDDLE_EAST", "EU", …):
        // needs no change here. `g.countryCode` may now carry one of those
        // instead of an ISO alpha-2, but this branch does a plain code-to-code
        // equality (`normCountry` only trims/uppercases — it never resolves a
        // code to a country), and a `place` suppression's stored `value` is
        // expected to be copied verbatim from a tag's own field, so both sides
        // stay in the same code space. A real alpha-2 code can never collide
        // with a supranational one (see `supranational-codes.ts`), so this is
        // safe by construction — not because it was special-cased.
        const country = (0, _personaContext.normCountry)(s.value ?? '');
        return (candidate.geoTags ?? []).some(g => (0, _personaContext.normText)(g.city ?? '') === value || (0, _personaContext.normText)(g.region ?? '') === value || (0, _personaContext.normCountry)(g.countryCode ?? '') === country);
      }
    case 'topic':
      return (candidate.matchedTopics ?? []).some(t => t.text != null && (0, _personaContext.normText)(t.text) === value);
    default:
      // Unreachable (STRUCTURED_KINDS gate above), but exhaustive-safe.
      return false;
  }
}

/**
 * THE ONE PREDICATE FOR "may this filter REMOVE a row?".
 *
 * `entity` may not. Entity extraction measured 68.8% correct on hand audit, and
 * the owner's ruling is that entities keep influencing RANK (the feedback
 * tree's entity like/dislike paths depend on them) but may never delete a
 * suggestion. One wrong entity should cost a story some position, not its
 * existence.
 *
 * Every other kind is unchanged — `place` (81.3%) and `event_type` (93.8%) keep
 * their hard-screen behaviour.
 *
 * The live path never even reaches this for entities: the hard/soft partition
 * in `mera-protocol/stage-scoring::loadPersonaScoringContext` files every
 * entity row as SOFT regardless of strength, so an entity filter is a penalty
 * by construction. This predicate is the second line of defence, for any caller
 * that hand-builds a hard list — the two together are why "entity cannot
 * exclude" holds without auditing every call site.
 */
function canHardExclude(s) {
  return (s.kind ?? 'keyword') !== 'entity';
}

/**
 * THE ONE headline-exemption predicate. Every hard-exclusion point must ask
 * this and nothing else; a second copy of the rule is exactly the drift the
 * one-matcher invariant exists to prevent.
 *
 * A row is headline-sourced when `headlineScope` is non-null (CITY/COUNTRY/
 * GLOBAL — set by the top-headline injection, null for topic-retrieved rows).
 * Such a row is exempt from HARD EXCLUSION only: a filter is about routine
 * coverage, not about hiding major news. It is still penalised — see
 * relevance.ts::computeRelevance, which folds the matching hard filters into the
 * ONE capped `splitSuppressionPenalty` and floors the result at HEADLINE_BASE_FLOOR
 * so the row lands at the bottom of what renders rather than vanishing.
 *
 * SCOPE — HARD-FILTER EXCLUSION ONLY. The LOW-band headline cull
 * (feed-ordering/importance-filter::isCulledHeadlineRelevance) is a scoring
 * OUTCOME, not a user-authored filter, and is deliberately outside this
 * exemption: a headline that scored below the MEDIUM band is noise on every
 * surface, exemption or not. That split is what makes an excluded headline
 * unambiguous downstream — no filter can ever have excluded one, so
 * `excluded && headlineScope != null` is by construction the cull. The
 * un-exclude sweep (services/suppression-sweep::unexcludeRetiredHardFilters)
 * relies on exactly that to avoid resurrecting culled headlines.
 */
function isHardFilterExempt(candidate) {
  return candidate.headlineScope != null;
}

/** The full result of a hard screen: what must go, and what MATCHED but stays. */

/**
 * Screen a batch of candidates against the HARD filters, partitioning the
 * matches into must-remove and headline-exempt.
 *
 * The display value is the user-facing form of the FIRST matching filter
 * (`value` ?? `pattern` ?? first keyword), so a caller can log/report/label
 * *why* without re-running the match. Ids in neither map matched nothing.
 */
function screenHardSuppressionsDetailed(candidates, hard) {
  const excluded = new Map();
  const exempted = new Map();
  if (!hard?.length || !candidates.length) return {
    excluded,
    exempted
  };
  for (const candidate of candidates) {
    const haystack = buildSuppressionHaystack(candidate);
    for (const s of hard) {
      // `entity` can never remove a row — see canHardExclude. Skipped rather
      // than bucketed into `exempted`: exempted means "matched, kept, LABEL the
      // card", and an unreliable entity match is not something to tell the user
      // their filter did. Its penalty is applied in computeRelevance instead.
      if (!canHardExclude(s)) continue;
      if (suppressionMatchesCandidate(candidate, s, haystack)) {
        const bucket = isHardFilterExempt(candidate) ? exempted : excluded;
        bucket.set(candidate.id, suppressionDisplayValue(s));
        break;
      }
    }
  }
  return {
    excluded,
    exempted
  };
}

/**
 * Screen a batch of candidates against the HARD filters.
 *
 * Returns candidateId → the user-facing display value of the FIRST matching
 * filter, for the rows that must be REMOVED. Ids absent from the map survive —
 * which includes headline-sourced rows that matched a filter but are
 * exempt from exclusion (`isHardFilterExempt`). Callers that need to know about
 * those (to label them) call `screenHardSuppressionsDetailed` instead; this thin
 * wrapper exists so every "which rows do I drop?" site keeps one answer.
 */
function screenHardSuppressions(candidates, hard) {
  return screenHardSuppressionsDetailed(candidates, hard).excluded;
}

/**
 * The hard filters that MATCH this candidate — the penalty side of the headline
 * exemption. Returned as suppression rows (not a boolean) so the caller can hand
 * them straight to `splitSuppressionPenalty`, which owns the cap.
 */
function matchingHardSuppressions(candidate, hard) {
  if (!hard?.length) return [];
  const haystack = buildSuppressionHaystack(candidate);
  return hard.filter(s => suppressionMatchesCandidate(candidate, s, haystack));
}

/** What to show the user for a filter: its structured value, else its pattern,
 *  else its first keyword, else a stable placeholder. */
function suppressionDisplayValue(s) {
  const value = (s.value ?? '').trim();
  if (value) return value;
  const pattern = (s.pattern ?? '').trim();
  if (pattern) return pattern;
  const keyword = (s.keywords ?? []).find(k => (k ?? '').trim().length > 0);
  return keyword?.trim() ?? 'filter';
}