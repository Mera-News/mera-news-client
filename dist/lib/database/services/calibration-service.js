"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getScoringOverrides = getScoringOverrides;
exports.recordOverrides = recordOverrides;
exports.restoreScoringOverrides = restoreScoringOverrides;
exports.runCalibration = runCalibration;
var _settingService = require("./setting-service");
var _personaChangeLogService = require("./persona-change-log-service");
var _cloudComplete = require("../../llm/cloudComplete");
var _toast = require("../../platform/toast");
var _logger = _interopRequireDefault(require("../../logger"));
var _config = require("../../news-harness/core/config");
var _calibration = require("../../news-harness/scoring-engine/calibration");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Calibration Service — the RN adapter for the override→calibration loop.
// Pure logic lives in
// lib/news-harness/scoring-engine/calibration.ts; this module supplies the
// device-coupled pieces:
//
//   - a PERSISTENT 7-day override counter + bounded case sample (settings KV);
//   - the threshold check that PRODUCES the `calibration` notification (with the
//     ≤1/7d + notify-cooldown rails), NOT an API call;
//   - runCalibration(): builds the report, makes ONE E2EE gateway call through
//     the existing inference path (cloudComplete — same client-side-encrypt
//     primitive as scoring), clamps the returned tweaks to ≤±20%/constant,
//     persists them to the `scoringEngineOverrides` layer, appends a revertible
//     change-log row, and resets the counter;
//   - getScoringOverrides(): the layer the math engine reads at scoring time.
//
// The gateway round-trip fires ONLY on explicit user confirm (runCalibration) —
// never automatically. recordOverrides() only tallies + (maybe) notifies.

// --- settings keys ---------------------------------------------------------

const KEY_COUNTER = 'calibration.override_counter';
const KEY_SAMPLE = 'calibration.override_sample';
const KEY_OVERRIDES = 'calibration.scoring_overrides';

/** Model + output budget for the single calibration completion. */
const CALIBRATION_MAX_TOKENS = 256;
const CALIBRATION_TEMPERATURE = 0.2;

// --- persistence helpers ---------------------------------------------------

async function readJson(key, fallback) {
  try {
    const raw = await (0, _settingService.getSetting)(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    _logger.default.warn('[calibration-service] failed to read setting — using fallback', {
      key,
      error: err instanceof Error ? err.message : String(err)
    });
    return fallback;
  }
}
async function readCounter() {
  const s = await readJson(KEY_COUNTER, _calibration.EMPTY_COUNTER_STATE);
  // Defensive: normalize a partial/corrupt row back to a valid shape.
  return {
    count: typeof s.count === 'number' ? s.count : 0,
    windowStartMs: typeof s.windowStartMs === 'number' ? s.windowStartMs : 0,
    lastNotifiedMs: typeof s.lastNotifiedMs === 'number' ? s.lastNotifiedMs : null,
    lastCalibrationMs: typeof s.lastCalibrationMs === 'number' ? s.lastCalibrationMs : null
  };
}
async function readSample() {
  const s = await readJson(KEY_SAMPLE, []);
  return Array.isArray(s) ? s : [];
}

// --- override capture + notification ---------------------------------------

/**
 * Record a batch of LARGE judge overrides (rows where |judge − computed| >
 * OVERRIDE_DELTA), captured by the scoring hot path. Cheap: one settings
 * read + write of the counter (+ the bounded sample). When the window count
 * crosses the threshold and the rails allow, PRODUCES the `calibration`
 * notification (persisted row + toast toward the bell) — no API call here.
 *
 * A no-op when `cases` is empty (the hot path skips the call entirely then).
 */
async function recordOverrides(cases) {
  if (cases.length === 0) {
    const cur = await readCounter();
    return {
      count: cur.count,
      notified: false
    };
  }
  const nowMs = Date.now();
  const prev = await readCounter();
  const next = (0, _calibration.recordInWindow)(prev, cases.length, nowMs);

  // If the window rolled over (re-anchored), the old sample is stale — drop it.
  const rolled = next.windowStartMs !== prev.windowStartMs;
  const prevSample = rolled ? [] : await readSample();
  const sample = (0, _calibration.appendCappedSample)(prevSample, cases);
  let notified = false;
  let stateToPersist = next;
  if ((0, _calibration.shouldFireNotification)(next, nowMs)) {
    try {
      await fireCalibrationNotification(next.count);
      stateToPersist = {
        ...next,
        lastNotifiedMs: nowMs
      };
      notified = true;
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          service: 'calibration-service',
          method: 'recordOverrides.notify'
        }
      });
    }
  }
  await Promise.all([(0, _settingService.setSetting)(KEY_COUNTER, JSON.stringify(stateToPersist)), (0, _settingService.setSetting)(KEY_SAMPLE, JSON.stringify(sample))]);
  return {
    count: next.count,
    notified
  };
}

/** Produce the calibration notification row + bell toast with the recalibrate
 *  chip. Raw i18n keys are stored so the panel re-resolves them per locale. */
async function fireCalibrationNotification(count) {
  await _toast.toastManager.showNotifiedToast({
    type: 'calibration',
    source: 'calibration-service',
    title: 'calibration.notificationTitle',
    body: 'calibration.notificationBody',
    icon: 'tune',
    context: {
      count
    },
    actions: [{
      id: 'recalibrate',
      labelKey: 'calibration.recalibrateChip'
    }]
  });
  _logger.default.info('[calibration-service] calibration notification produced', {
    count
  });
}

// --- overrides layer (read by the scoring engine) --------------------------

/** The persisted fractional overrides the math engine layers over the base
 *  ScoringEngineConfig at scoring time. {} when never calibrated. */
async function getScoringOverrides() {
  const raw = await readJson(KEY_OVERRIDES, {});
  return raw && typeof raw === 'object' ? raw : {};
}

// --- the calibration run (explicit user confirm ONLY) ----------------------

/**
 * Run the calibration: build the report from the retained override sample, make
 * the ONE E2EE gateway call, clamp + compose the returned tweaks onto the
 * persisted overrides, change-log the mutation, and reset the counter.
 * Fail-safe: gateway/parse failure returns 'failed' and leaves state untouched.
 */
async function runCalibration() {
  const sample = await readSample();
  const report = (0, _calibration.buildCalibrationReport)(sample);
  let rawDeltas;
  try {
    const output = await (0, _cloudComplete.cloudComplete)({
      systemPrompt: _calibration.CALIBRATION_SYSTEM_PROMPT,
      prompt: (0, _calibration.buildCalibrationUserMessage)(report),
      route: 'background',
      maxTokens: CALIBRATION_MAX_TOKENS,
      temperature: CALIBRATION_TEMPERATURE
    }, {
      // INTERACTIVE: this call only ever fires on an explicit in-chat confirm,
      // so a person is waiting on it. Left on the default background lane it
      // would queue behind a scoring cycle.
      lane: 'interactive'
    });
    rawDeltas = (0, _calibration.parseCalibrationDeltas)(output);
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'calibration-service',
        method: 'runCalibration.gateway'
      }
    });
    return {
      status: 'failed'
    };
  }
  const clamped = (0, _calibration.clampCalibrationDeltas)(rawDeltas, _config.DEFAULT_HARNESS_CONFIG.scoringEngine);
  if (Object.keys(clamped).length === 0) {
    // Nothing actionable came back — reset the counter (the invitation is
    // consumed) but record no change.
    await resetCounterAfterCalibration();
    _logger.default.info('[calibration-service] calibration produced no actionable deltas');
    return {
      status: 'no_change'
    };
  }
  const prevOverrides = await getScoringOverrides();
  const nextOverrides = (0, _calibration.mergeAndClampOverrides)(prevOverrides, clamped);
  await (0, _settingService.setSetting)(KEY_OVERRIDES, JSON.stringify(nextOverrides));

  // Change-log the mutation. NOTE: persona-change-log's revertChange
  // does not yet invert 'set_scoring_override'; we record { before, after } so a
  // later revert path (or restoreScoringOverrides below) can revert it.
  let changeLogId;
  try {
    const row = await (0, _personaChangeLogService.append)({
      actionType: 'set_scoring_override',
      action: {
        before: prevOverrides,
        after: nextOverrides,
        delta: undefined
      },
      source: 'user',
      // Not shown: the audit screen renders the row from its action type
      // (persona-audit/change-summary.ts), in the app language.
      summary: `set_scoring_override (${Object.keys(clamped).length} constants)`
    });
    changeLogId = row.id;
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'calibration-service',
        method: 'runCalibration.changelog'
      }
    });
  }
  await resetCounterAfterCalibration();
  _logger.default.info('[calibration-service] calibration applied', {
    tuned: Object.keys(clamped)
  });
  return {
    status: 'applied',
    applied: clamped,
    overrides: nextOverrides,
    changeLogId
  };
}

/** Reset counter + clear the sample; stamp lastCalibrationMs (arms the ≤1/7d
 *  rail). Called after every completed run (applied or no_change). */
async function resetCounterAfterCalibration() {
  const nowMs = Date.now();
  const cleared = {
    count: 0,
    windowStartMs: nowMs,
    lastNotifiedMs: null,
    lastCalibrationMs: nowMs
  };
  await Promise.all([(0, _settingService.setSetting)(KEY_COUNTER, JSON.stringify(cleared)), (0, _settingService.setSetting)(KEY_SAMPLE, JSON.stringify([]))]);
}

/**
 * Revert the scoring-override layer to a prior state (the `before` recorded in a
 * `set_scoring_override` change-log row). Provided because revertChange can't
 * yet invert this action type; the audit UI can call this directly.
 */
async function restoreScoringOverrides(overrides) {
  await (0, _settingService.setSetting)(KEY_OVERRIDES, JSON.stringify(overrides ?? {}));
}