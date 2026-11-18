"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.applyPersonaAction = applyPersonaAction;
exports.applyPersonaActions = applyPersonaActions;
var topicService = _interopRequireWildcard(require("./topic-service"));
var factService = _interopRequireWildcard(require("./fact-service"));
var suppressionService = _interopRequireWildcard(require("./suppression-service"));
var locationService = _interopRequireWildcard(require("./location-service"));
var publicationPreferenceService = _interopRequireWildcard(require("./publication-preference-service"));
var changeLogService = _interopRequireWildcard(require("./persona-change-log-service"));
var mutationRailsService = _interopRequireWildcard(require("./mutation-rails-service"));
var _logger = _interopRequireDefault(require("../../logger"));
var _actionNames = require("../../news-harness/persona-management/action-names");
var _PersonaSuppression = require("../models/PersonaSuppression");
var _personaMutationSweeps = require("./persona-mutation-sweeps");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
// Persona-Action Executor — the single dispatch point for ALL deterministic
// persona mutations. The feedback-tree overlay leaves AND the feedback
// agent's proposals both route through `applyPersonaAction`: it maps each
// `action_type` to the right WatermelonDB service, and every mutation appends
// exactly one invertible `persona_change_log` row (so `revertChange` can undo
// it). No mutation math lives here — the arithmetic is in the pure rails; this
// is glue over the per-collection services + mutation-rails adapter.
//
// Contract: never throws (callers batch). Unsupported/incomplete actions return
// `{ applied: false, summary }` instead of raising. Nudge SUGGESTIONS
// (`nudge_subscribe_publication` / `nudge_browse_related`) are NOT persona
// mutations — they return `{ applied: false }` and write NO change-log row (the
// UI surfaces the nudge).

/** Default weight for a minted NEGATIVE topic when the action omits one. */
const DEFAULT_NEGATIVE_TOPIC_WEIGHT = -0.6;
/** Default weight for a minted POSITIVE topic (explicit interest) when omitted. */
const DEFAULT_POSITIVE_TOPIC_WEIGHT = 0.5;
/** Default strength for a minted suppression (soft — score penalty) when omitted. */
const DEFAULT_SUPPRESSION_STRENGTH = 0.5;
/** Short 2-dp weight label for summaries (English only). */
function fmt(w) {
  return w.toFixed(2);
}

/** Known action, but missing/invalid fields → skipped (never thrown). */
function skipped(action, reason) {
  return {
    applied: false,
    summary: `skipped ${action.action_type}: ${reason}`
  };
}

/** Map a change-log source to the publication-preference provenance enum. */
function pubProvenanceFor(source) {
  if (source === 'user') return 'user';
  if (source === 'migration') return 'migration';
  return 'feedback';
}

/**
 * Validate an incoming suppression kind against the v46 vocabulary. Unknown /
 * absent ⇒ `undefined`, which the service stores as a NULL `kind` column and
 * `kindOf` reads back as 'keyword' — the historical behaviour. A bogus kind must
 * degrade to a keyword filter, never persist a value nothing will ever match.
 */
function normalizeSuppressionKind(raw, value) {
  if (!raw) return undefined;
  if (!_PersonaSuppression.SUPPRESSION_KINDS.includes(raw)) return undefined;
  const kind = raw;
  // Same guard, second failure mode: every STRUCTURED kind compares against
  // `value` by exact normalized equality, and the matcher treats an absent
  // value as "matches nothing" (deliberately — never "matches everything").
  // Persisting a valueless structured kind would therefore store a filter that
  // looks active and does nothing, which is precisely what this validation
  // exists to prevent. Degrade to keyword so the row still matches on its
  // keywords / human pattern. Reachable: proposals arrive from an LLM.
  if (kind !== 'keyword' && !value) return undefined;
  return kind;
}

/**
 * Single dispatch point for ALL deterministic persona mutations (feedback tree
 * leaves + feedback agent proposals). Routes each action_type to the right
 * service, and every mutation appends an invertible persona_change_log row.
 */
async function applyPersonaAction(action, source) {
  try {
    return await dispatch(action, source);
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'persona-action-executor',
        action_type: action.action_type
      }
    });
    return {
      applied: false,
      summary: `error applying ${action.action_type}`
    };
  }
}

/** Convenience: apply a list, best-effort, returning per-action results. */
async function applyPersonaActions(actions, source) {
  const results = [];
  for (const action of actions) {
    // applyPersonaAction never throws — one bad action can't abort the batch.
    results.push(await applyPersonaAction(action, source));
  }
  return results;
}
async function dispatch(action, source) {
  switch (action.action_type) {
    // -- Topic weight -------------------------------------------------------
    case _actionNames.ACTION_NAMES.SET_TOPIC_WEIGHT:
      {
        if (!action.topicId) return skipped(action, 'missing topicId');
        if (typeof action.delta === 'number') {
          // Budget-leashed nudge (mutation-rails owns the append + budget).
          const r = await mutationRailsService.nudgeTopic(action.topicId, action.delta, source);
          return {
            applied: r.applied,
            // MUST be threaded back: the feedback layer stores the ids a leaf
            // minted onto the verdict row and un-voting reverts exactly those.
            // Dropping it made every topic-weight leaf (not_important,
            // wrong_topic, a_lot_more, a_bit_more) un-undoable — the thumb went
            // hollow while the weight stayed nudged, which is precisely the
            // ambiguity the fill-state contract exists to remove.
            changeLogId: r.changeLogId,
            summary: r.applied ? `Nudged topic weight to ${fmt(r.after)}` : r.retired ? 'Topic is retired; weight unchanged' : 'Nudge budget exhausted; topic weight unchanged'
          };
        }
        if (typeof action.weight === 'number') {
          const r = await mutationRailsService.setTopicWeightAbsolute(action.topicId, action.weight, source);
          return {
            applied: r.applied,
            changeLogId: r.changeLogId,
            summary: r.applied ? `Set topic weight to ${fmt(r.after)}` : 'Topic weight unchanged'
          };
        }
        return skipped(action, 'no delta or weight');
      }

    // -- Topic high-priority pin -------------------------------------------
    case _actionNames.ACTION_NAMES.SET_HIGH_PRIORITY:
      {
        if (!action.topicId) return skipped(action, 'missing topicId');
        if (typeof action.highPriority !== 'boolean') return skipped(action, 'missing highPriority');
        // Same id-threading contract as the nudge above. `?.` because the helper
        // returned void until this fix and test doubles may still resolve
        // undefined — a missing id must not throw, just mean "nothing to revert".
        const r = await mutationRailsService.setTopicHighPriority(action.topicId, action.highPriority, source);
        return {
          applied: true,
          changeLogId: r?.changeLogId,
          summary: action.highPriority ? 'Pinned topic as high priority' : 'Unpinned topic'
        };
      }

    // -- Fact weight nudge --------------------------------------------------
    case _actionNames.ACTION_NAMES.SET_FACT_WEIGHT:
      {
        if (!action.factId) return skipped(action, 'missing factId');
        if (typeof action.delta !== 'number') return skipped(action, 'missing delta');
        // Same id-threading contract (and same `?.` rationale) as above.
        const r = await mutationRailsService.nudgeFactWeight(action.factId, action.delta, source);
        return {
          applied: true,
          changeLogId: r?.changeLogId,
          summary: 'Adjusted fact weight'
        };
      }

    // -- Mint a NEGATIVE topic ---------------------------------------------
    case _actionNames.ACTION_NAMES.ADD_NEGATIVE_TOPIC:
      {
        const text = action.topicText?.trim();
        if (!text) return skipped(action, 'missing topicText');
        const weight = typeof action.weight === 'number' ? action.weight : DEFAULT_NEGATIVE_TOPIC_WEIGHT;
        const [created] = await topicService.createTopics([{
          text,
          weight,
          status: 'active',
          provenance: 'feedback'
        }]);
        if (!created) return {
          applied: false,
          summary: 'failed to create negative topic'
        };
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.ADD_NEGATIVE_TOPIC,
          action: {
            targetId: created.id,
            text
          },
          source,
          summary: `Added negative topic: ${text}`
        });
        return {
          applied: true,
          changeLogId: row.id,
          summary: `Added negative topic: ${text}`
        };
      }

    // -- Mint a POSITIVE topic ---------------------------------------------
    case _actionNames.ACTION_NAMES.ADD_TOPIC:
      {
        const text = action.topicText?.trim();
        if (!text) return skipped(action, 'missing topicText');
        const weight = typeof action.weight === 'number' ? action.weight : DEFAULT_POSITIVE_TOPIC_WEIGHT;
        const [created] = await topicService.createTopics([{
          text,
          weight,
          status: 'active',
          provenance: 'feedback'
        }]);
        if (!created) return {
          applied: false,
          summary: 'failed to create topic'
        };
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.ADD_TOPIC,
          action: {
            targetId: created.id,
            text
          },
          source,
          summary: `Added topic: ${text}`
        });
        return {
          applied: true,
          changeLogId: row.id,
          summary: `Added topic: ${text}`
        };
      }

    // -- Retire a topic -----------------------------------------------------
    case _actionNames.ACTION_NAMES.RETIRE_TOPIC:
      {
        if (!action.topicId) return skipped(action, 'missing topicId');
        await topicService.retire(action.topicId);
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.RETIRE_TOPIC,
          action: {
            targetId: action.topicId
          },
          source,
          summary: 'Retired topic'
        });
        return {
          applied: true,
          changeLogId: row.id,
          summary: 'Retired topic'
        };
      }

    // -- Discard a fact (topic-plan card) -----------------------------------
    //
    // Modelled on RETIRE_TOPIC above (guard → mutate → append one change-log
    // row → return its id) with two deliberate differences:
    //
    //  1. The statement is read BEFORE the delete, for the same reason
    //     RETIRE_SUPPRESSION reads its row first: a bare id is useless in the
    //     Activity list.
    //  2. It is NOT invertible. `deleteFact` runs `destroyCascade()`, which
    //     destroys the fact AND its topics permanently — there is nothing for
    //     `revertChange` to restore, so no inverse case is added and
    //     `action-display.isRevertible` deny-lists this type (that file's
    //     deny-list is opt-OUT, so the two edits must always ship together).
    //     The change-log row is the audit trail, not an undo.
    case _actionNames.ACTION_NAMES.DISCARD_FACT:
      {
        if (!action.factId) return skipped(action, 'missing factId');
        const facts = await factService.getFacts();
        const existing = facts.find(f => f.id === action.factId);
        if (!existing) return {
          applied: false,
          summary: 'fact not found'
        };
        await factService.deleteFact(action.factId);
        const summary = `Discarded fact: ${existing.statement}`;
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.DISCARD_FACT,
          action: {
            targetId: action.factId,
            statement: existing.statement
          },
          source,
          summary
        });
        return {
          applied: true,
          changeLogId: row.id,
          summary
        };
      }

    // -- Mint a suppression -------------------------------------------------
    case _actionNames.ACTION_NAMES.ADD_SUPPRESSION:
      {
        const pattern = action.suppressionPattern?.trim();
        if (!pattern) return skipped(action, 'missing suppressionPattern');
        const strength = typeof action.suppressionStrength === 'number' ? action.suppressionStrength : DEFAULT_SUPPRESSION_STRENGTH;
        const value = action.suppressionValue?.trim() || undefined;
        const kind = normalizeSuppressionKind(action.suppressionKind, value);
        const suppression = await suppressionService.addSuppression({
          pattern,
          keywords: action.suppressionKeywords ?? [],
          strength,
          // Was hardcoded 'feedback', which mislabelled every filter the user
          // created by hand. The suppression `source` enum has no 'chat'/'digest'
          // → 'feedback' equivalents worth splitting here, so: user means user,
          // everything else is feedback.
          source: source === 'user' ? 'user' : 'feedback',
          kind,
          value
        });
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.ADD_SUPPRESSION,
          action: {
            targetId: suppression.id,
            kind,
            value
          },
          source,
          summary: `Suppressed: ${pattern}`
        });
        // Hard filters are retroactive — screen what is ALREADY stored.
        // Soft suppressions are a score penalty, so they wait for the next pass.
        // Compare the strength WE clamped/defaulted, not the persisted row's:
        // the decision is about the action, and it must not depend on the shape
        // the service happens to return.
        await (0, _personaMutationSweeps.runSweepFor)((0, _personaMutationSweeps.sweepForMutation)({
          actionType: action.action_type,
          hardFilter: strength >= suppressionService.HARD_SUPPRESSION_STRENGTH
        }), action.action_type);
        return {
          applied: true,
          changeLogId: row.id,
          summary: `Suppressed: ${pattern}`
        };
      }

    // -- Remove a suppression (audited, invertible) -------------------------
    case _actionNames.ACTION_NAMES.RETIRE_SUPPRESSION:
      {
        const suppressionId = action.suppressionId;
        if (!suppressionId) return skipped(action, 'missing suppressionId');
        // Load the row BEFORE retiring it. Two reasons, both load-bearing: the
        // change-log summary has to name the pattern (a bare id is useless in the
        // audit list), and the row's strength is what decides whether the
        // un-exclude sweep runs. The service exposes no getById, so this mirrors
        // SET_LOCATION_WEIGHT's getAll + find.
        const all = await suppressionService.getAll();
        const existing = all.find(s => s.id === suppressionId);
        if (!existing) return {
          applied: false,
          summary: 'suppression not found'
        };
        const wasHard = existing.strength >= suppressionService.HARD_SUPPRESSION_STRENGTH;
        const kind = suppressionService.kindOf(existing);
        const pattern = existing.pattern;
        await suppressionService.retireSuppression(suppressionId);
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.RETIRE_SUPPRESSION,
          action: {
            targetId: suppressionId,
            pattern,
            kind
          },
          source,
          summary: `Removed filter: ${pattern}`
        });
        // Retiring a HARD filter gives its casualties a second chance. Rows
        // a still-active filter also matches stay excluded (the sweep re-screens
        // against the live persona, so the two-filters-on-one-row case is free).
        // The released rows come back `unscored` for the next scoring pass.
        await (0, _personaMutationSweeps.runSweepFor)((0, _personaMutationSweeps.sweepForMutation)({
          actionType: action.action_type,
          hardFilter: wasHard
        }), action.action_type);
        return {
          applied: true,
          changeLogId: row.id,
          summary: `Removed filter: ${pattern}`
        };
      }

    // -- Location weight ----------------------------------------------------
    case _actionNames.ACTION_NAMES.SET_LOCATION_WEIGHT:
      {
        if (!action.locationId) return skipped(action, 'missing locationId');
        if (typeof action.weight !== 'number') return skipped(action, 'missing weight');
        const all = await locationService.getAll();
        const loc = all.find(l => l.id === action.locationId);
        if (!loc) return {
          applied: false,
          summary: 'location not found'
        };
        const before = loc.weight;
        const after = Math.max(0, Math.min(1, action.weight)); // location weights ∈ [0,1]
        await locationService.setWeight(action.locationId, after);
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.SET_LOCATION_WEIGHT,
          action: {
            targetId: action.locationId,
            before,
            after
          },
          source,
          summary: `Adjusted location weight ${fmt(before)} → ${fmt(after)}`
        });
        return {
          applied: true,
          changeLogId: row.id,
          summary: 'Adjusted location weight'
        };
      }

    // -- Publication preference ---------------------------------------------
    case _actionNames.ACTION_NAMES.SET_PUBLICATION_PREF:
      {
        if (!action.publicationId) return skipped(action, 'missing publicationId');
        if (!action.publicationPref) return skipped(action, 'missing publicationPref');
        const before = await publicationPreferenceService.getPreferenceKind(action.publicationId);
        await publicationPreferenceService.setPreferenceKind(action.publicationId, action.publicationPref, pubProvenanceFor(source));
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.SET_PUBLICATION_PREF,
          action: {
            targetId: action.publicationId,
            before,
            after: action.publicationPref
          },
          source,
          summary: `Set publication preference: ${action.publicationId} → ${action.publicationPref}`
        });
        // A mute (weight ≤ -0.9) IS a hard `kind:'publication'` filter — it
        // is synthesized as one when the scoring context loads, so both sweeps
        // see it live with no extra plumbing here. Muting purges retroactively;
        // raising the weight back above -0.9 (unmute, incl. switching to
        // boost/deprioritize/none) releases what the mute had excluded.
        await (0, _personaMutationSweeps.runSweepFor)((0, _personaMutationSweeps.sweepForMutation)({
          actionType: action.action_type,
          prefBefore: before,
          prefAfter: action.publicationPref
        }), action.action_type);
        return {
          applied: true,
          changeLogId: row.id,
          summary: `Set publication preference: ${action.publicationId} → ${action.publicationPref}`
        };
      }

    // -- Source SCOPE preference (source-pref v47) --------------------------
    //
    // Same 5 steps as SET_PUBLICATION_PREF above (guard → read `before` → apply
    // → append change-log row → sweep), against the scope half of the SAME
    // table. Two deliberate differences:
    //
    //  1. `mute` is REJECTED. A scope mute is not synthesized into a hard
    //     `kind:'publication'` filter anywhere — the first version excludes scope rows
    //     from the muted-publication hard-filter derivation in
    //     lib/mera-protocol/stage-scoring.ts — so accepting one would promise
    //     an exclusion nothing implements. The sanitizer rejects it first; this
    //     is the second gate, for callers that don't go through chat.
    //  2. `targetId` is the COMPOSITE `'{scopeKind}:{scopeValue}'`
    //     (e.g. 'country:IND'), because a scope has no row id the log can point
    //     at and the inverse must be able to rebuild the whole SourceScopeRef
    //     from the log alone. The Source-preferences screen writes the same
    //     encoding, so both producers and `revertChange` agree on one shape.
    case _actionNames.ACTION_NAMES.SET_SOURCE_SCOPE_PREF:
      {
        if (!action.scopeKind) return skipped(action, 'missing scopeKind');
        if (!action.scopeValue) return skipped(action, 'missing scopeValue');
        if (!action.publicationPref) return skipped(action, 'missing publicationPref');
        if (action.publicationPref === 'mute') {
          return skipped(action, 'a source scope cannot be muted');
        }
        const scope = {
          scopeKind: action.scopeKind,
          scopeValue: action.scopeValue
        };
        const label = action.scopeLabel?.trim() || action.scopeValue;
        const before = await publicationPreferenceService.getScopePreferenceKind(scope);
        await publicationPreferenceService.setScopePreferenceKind(scope, action.publicationPref, label, pubProvenanceFor(source));
        const summary = `Set source preference: ${label} → ${action.publicationPref}`;
        const row = await changeLogService.append({
          actionType: _actionNames.ACTION_NAMES.SET_SOURCE_SCOPE_PREF,
          action: {
            targetId: `${action.scopeKind}:${action.scopeValue}`,
            before,
            after: action.publicationPref,
            // Carried so the inverse can restore a boost/deprioritize row with
            // the label the user actually saw — `setScopePreferenceKind` needs
            // one whenever `before` is not 'none'.
            label
          },
          source,
          summary
        });
        // Mute is unreachable above, so this is a no-op today by construction.
        // It is wired anyway because persona-mutation-sweeps' whole thesis is
        // that a new action type can never be live in one path and missing in
        // the other; if a scope exclusion is ever implemented, the boundary rule
        // and its mirror are already here.
        await (0, _personaMutationSweeps.runSweepFor)((0, _personaMutationSweeps.sweepForMutation)({
          actionType: action.action_type,
          prefBefore: before,
          prefAfter: action.publicationPref
        }), action.action_type);
        return {
          applied: true,
          changeLogId: row.id,
          summary
        };
      }

    // -- Nudges are SUGGESTIONS, not mutations — no change-log row ----------
    case _actionNames.ACTION_NAMES.NUDGE_SUBSCRIBE_PUBLICATION:
      {
        return {
          applied: false,
          summary: `Suggestion: subscribe to ${action.publicationId ?? 'publication'}`
        };
      }
    case _actionNames.ACTION_NAMES.NUDGE_BROWSE_RELATED:
      {
        return {
          applied: false,
          summary: `Suggestion: browse related to ${action.topicText ?? action.topicId ?? 'topic'}`
        };
      }
    default:
      return {
        applied: false,
        summary: `unsupported: ${action.action_type}`
      };
  }
}