"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.nudgeFactWeight = void 0;
exports.nudgeTopic = nudgeTopic;
exports.setTopicHighPriority = setTopicHighPriority;
exports.setTopicWeightAbsolute = setTopicWeightAbsolute;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var topicService = _interopRequireWildcard(require("./topic-service"));
var changeLogService = _interopRequireWildcard(require("./persona-change-log-service"));
var _actionNames = require("../../news-harness/persona-management/action-names");
var _mutationRails = require("../../news-harness/persona-management/mutation-rails");
var _command = require("../../sync/command");
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Mutation-Rails Service — WatermelonDB adapter for the bounded persona
// mutations. Thin glue: it reads the current persona state,
// delegates the DECISIONS to the pure rails
// (lib/news-harness/persona-management/mutation-rails.ts), writes the result
// via the existing per-collection services, and appends an invertible
// change-log row for every applied mutation. No mutation math lives here.

const topicsCollection = _index.default.get('topics');
const factsCollection = _index.default.get('facts');
const changeLogCollection = _index.default.get('persona_change_log');

/** Short 2-dp weight label for change-log summaries (English only). */
function fmt(w) {
  return w.toFixed(2);
}

/** Local midnight (ms) — the per-day nudge-budget window boundary. */
function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function parseActionJson(json) {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Sum of |delta| of today's `set_topic_weight` rows targeting this topic — the
 * budget already spent, fed to the pure `nudgeTopicWeight`.
 */
async function todayTopicBudgetUsedAbs(topicId) {
  const sinceMs = startOfTodayMs();
  const rows = await changeLogCollection.query(_watermelondb.Q.where('action_type', _actionNames.ACTION_NAMES.SET_TOPIC_WEIGHT), _watermelondb.Q.where('created_at', _watermelondb.Q.gte(sinceMs))).fetch();
  let used = 0;
  for (const row of rows) {
    // Defensive re-filter (the unit-test mock DB ignores Q.where predicates).
    if (row.actionType !== _actionNames.ACTION_NAMES.SET_TOPIC_WEIGHT) continue;
    if (row.createdAt.getTime() < sinceMs) continue;
    const action = parseActionJson(row.actionJson);
    if (!action || action.targetId !== topicId) continue;
    if (typeof action.delta === 'number') used += Math.abs(action.delta);
  }
  return used;
}

/**
 * Nudge a topic's weight under the per-topic per-day budget. Reads the current
 * weight + today's spent budget, runs the pure rail, and — only when the delta
 * actually moved the weight — writes it and appends a `set_topic_weight` row.
 * When the budget is exhausted (appliedDelta 0) NOTHING is written: the signal
 * is recorded elsewhere, the weight is unchanged, and the digest decides.
 *
 * Returns the change-log id whenever a row was appended. This is NOT optional
 * bookkeeping: the feedback layer stores the ids a leaf minted onto the verdict
 * row and un-voting reverts exactly those, so a helper that appends without
 * handing the id back produces a leaf that can be cast but never un-cast.
 */
async function nudgeTopic(topicId, delta, source) {
  const topic = await topicsCollection.find(topicId);
  // A retired topic is history only: nothing to nudge, nothing to log.
  if (topic.status === 'retired') return {
    applied: false,
    after: topic.weight,
    retired: true
  };
  const usedAbs = await todayTopicBudgetUsedAbs(topicId);
  const result = (0, _mutationRails.nudgeTopicWeight)(topic.weight, delta, usedAbs);
  if (result.appliedDelta === 0) {
    return {
      applied: false,
      after: result.before
    };
  }
  await topicService.setWeight(topicId, result.after);
  const row = await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.SET_TOPIC_WEIGHT,
    action: {
      targetId: topicId,
      before: result.before,
      after: result.after,
      delta: result.appliedDelta
    },
    source,
    summary: `Adjusted topic weight ${fmt(result.before)} → ${fmt(result.after)}`
  });
  return {
    applied: true,
    after: result.after,
    changeLogId: row.id
  };
}

/**
 * Set a topic's weight to an ABSOLUTE value (no per-day budget leash — used by
 * the feedback tree / agent when a slider or explicit choice picks a target
 * weight rather than nudging). Reads the prior weight, clamps + writes the new
 * one, and appends an invertible `set_topic_weight` row. A no-op (before===after)
 * writes nothing. Returns the change-log id so the dispatcher can surface it.
 */
async function setTopicWeightAbsolute(topicId, weight, source) {
  const topic = await topicsCollection.find(topicId);
  const before = topic.weight;
  const after = (0, _mutationRails.clampWeight)(weight);
  if (before === after) {
    return {
      applied: false,
      before,
      after
    };
  }
  await topicService.setWeight(topicId, after);
  const row = await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.SET_TOPIC_WEIGHT,
    action: {
      targetId: topicId,
      before,
      after
    },
    source,
    summary: `Set topic weight ${fmt(before)} → ${fmt(after)}`
  });
  return {
    applied: true,
    before,
    after,
    changeLogId: row.id
  };
}

/**
 * Set a topic's high-priority flag (score-only boost; no weight delta). Records
 * the prior boolean so `revertChange` can restore it, and returns the
 * change-log id so the caller can make the change un-votable (see nudgeTopic).
 * A no-op returns `applied: false` and no id — there is nothing to revert.
 */
async function setTopicHighPriority(topicId, highPriority, source) {
  const topic = await topicsCollection.find(topicId);
  const before = topic.highPriority;
  if (before === highPriority) return {
    applied: false
  }; // no-op — nothing to log
  await topicService.setHighPriority(topicId, highPriority);
  const row = await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.SET_HIGH_PRIORITY,
    action: {
      targetId: topicId,
      before,
      after: highPriority
    },
    source,
    summary: highPriority ? 'Pinned topic as high priority' : 'Unpinned topic'
  });
  return {
    applied: true,
    changeLogId: row.id
  };
}

/**
 * Nudge a fact's weight. `before` is the ACTUAL stored value (may be null ⇒ the
 * 1.0 baseline is used for the arithmetic but the null is logged verbatim, so
 * revert restores the exact prior state — mirroring revertChange's
 * number|null handling for set_fact_weight).
 */
async function nudgeFactWeightLocal(factId, delta, source) {
  const fact = await factsCollection.find(factId);
  const before = fact.weight ?? null;
  const after = (0, _mutationRails.clampWeight)((before ?? 1) + delta);
  await _index.default.write(async () => {
    await fact.update(f => {
      f.weight = after;
      f.updatedAt = new Date();
    });
  });
  const row = await changeLogService.append({
    actionType: _actionNames.ACTION_NAMES.SET_FACT_WEIGHT,
    action: {
      targetId: factId,
      before,
      after
    },
    source,
    summary: `Adjusted fact weight ${fmt(before ?? 1)} → ${fmt(after)}`
  });
  return {
    applied: true,
    changeLogId: row.id
  };
}
const nudgeFactWeight = exports.nudgeFactWeight = (0, _command.command)('nudgeFactWeight', nudgeFactWeightLocal);