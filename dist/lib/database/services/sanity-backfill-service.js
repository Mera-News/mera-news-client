"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SANITY_BACKFILL_MAX_TOPICS = exports.BACKFILL_CHUNK_TOPICS = void 0;
exports.isBackfillDone = isBackfillDone;
exports.runSanityBackfillChunk = runSanityBackfillChunk;
var _onDeviceGate = require("../../llm/on-device-gate");
var _logger = _interopRequireDefault(require("../../logger"));
var _settingService = require("./setting-service");
var _factService = require("./fact-service");
var _topicSanityService = require("./topic-sanity-service");
var _hygieneService = require("./hygiene-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// One-time topic-sanity backfill.
//
// The weekly sweep audits 60 topics a week, which prevents new contamination but
// would take a month to reach what is already on the device. The user asked for
// the existing mess cleaned now, WITH replacements, so this walks the whole
// corpus once — in chunks, at idle, self-disabling when finished.
//
// RESUMABILITY is the design constraint, and it is why the state is two stamps
// plus the audit cursor rather than a progress counter:
//
//   • `sanity_backfill_started_at` — the cursor was reset; the pass has begun.
//     Its presence is what stops a relaunch resetting the cursor again and
//     re-auditing from scratch every time the app starts.
//   • `sanity_audited_through_ms`  — how far the corpus has actually been
//     walked. Owned by topic-sanity-service; this service moves it only
//     after the chunk's proposals are stored, so a chunk killed or failed
//     mid-flight is retried, not skipped.
//   • `sanity_backfill_done_at`    — set ONLY when a chunk comes back with
//     nothing left to audit (or the hard ceiling is hit). A pass killed halfway
//     therefore cannot mark itself done: the stamp is written from the
//     completion condition, never from "we ran".
//
// Killed midway ⇒ next idle foreground resumes at the cursor. Never re-runs from
// scratch; never claims completion having processed half the corpus.

const STARTED_KEY = 'sanity_backfill_started_at';
const DONE_KEY = 'sanity_backfill_done_at';
const AUDITED_KEY = 'sanity_backfill_audited_count';
const NOTIFIED_KEY = 'sanity_backfill_notified';

/** Topics audited per run, then yield. 60 = 4 batches in one HTTP round trip —
 *  the same shape the weekly sweep uses, so the cost per run is already known. */
const BACKFILL_CHUNK_TOPICS = exports.BACKFILL_CHUNK_TOPICS = 60;

/** Hard ceiling across the WHOLE pass. A pathological corpus cannot produce an
 *  unbounded run; beyond this the remainder falls back to the weekly rhythm. */
const SANITY_BACKFILL_MAX_TOPICS = exports.SANITY_BACKFILL_MAX_TOPICS = 600;
const SKIPPED = reason => ({
  ran: false,
  reason,
  audited: 0,
  proposalsAdded: 0,
  done: false
});
async function readNumber(key) {
  const raw = Number(await (0, _settingService.getSetting)(key));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** True once the pass has finished — every later call is a single settings read. */
async function isBackfillDone() {
  return (await readNumber(DONE_KEY)) > 0;
}

/**
 * Run ONE chunk of the backfill. Safe to call on every scheduler tick: returns
 * immediately once done, and never throws.
 */
async function runSanityBackfillChunk(opts) {
  try {
    if (await isBackfillDone()) return SKIPPED('already_done');
    // On-device mode never calls the cloud AI. Checked BEFORE the cursor reset
    // and the started stamp, so switching back to cloud resumes cleanly.
    if (await (0, _onDeviceGate.isOnDeviceMode)()) return SKIPPED('on_device');
    const now = opts?.now ?? Date.now();

    // Begin: reset the audit cursor so topics minted BEFORE the prompt fix are
    // re-judged. Guarded by the started stamp, or every launch would rewind.
    const startedAt = await readNumber(STARTED_KEY);
    if (startedAt === 0) {
      await (0, _topicSanityService.resetSanityCursor)();
      await (0, _settingService.setSetting)(STARTED_KEY, String(now));
    }
    const facts = await (0, _factService.getFacts)();
    if (facts.length === 0) {
      // Nothing to judge topics against; don't burn the once-only flag on it.
      return SKIPPED('no_facts');
    }
    const result = await (0, _topicSanityService.runSanityAudit)({
      facts: facts.map(f => ({
        id: f.id,
        statement: f.statement
      })),
      maxTopics: BACKFILL_CHUNK_TOPICS
    });

    // The credential was lost mid-run: nothing ran, so nothing is recorded and
    // the next tick retries.
    if (result.skipped) return {
      ran: false,
      audited: 0,
      proposalsAdded: 0,
      done: false
    };
    const auditedTotal = (await readNumber(AUDITED_KEY)) + result.audited;
    let proposalsAdded = 0;
    if (result.incoherentFacts.length > 0) {
      // Notify ONCE for the whole pass, on the first chunk that finds anything —
      // not once per chunk, which would be a notification storm.
      const alreadyNotified = (await (0, _settingService.getSetting)(NOTIFIED_KEY)) === '1';
      proposalsAdded = await (0, _hygieneService.addSanityProposals)(result.incoherentFacts, {
        notify: !alreadyNotified,
        now
      });
      if (!alreadyNotified && proposalsAdded > 0) {
        await (0, _settingService.setSetting)(NOTIFIED_KEY, '1');
      }
    }

    // The verdicts are stored: only now does the cursor move past them. A failed
    // write above leaves it, so the retry finds the same topics.
    await (0, _topicSanityService.commitSanityCursor)(result);
    await (0, _settingService.setSetting)(AUDITED_KEY, String(auditedTotal));

    // COMPLETION, derived — never "we ran, so we're done". Only a plan with
    // nothing left means the cursor has reached the newest topic; a failed
    // chunk also audits nothing.
    const exhausted = result.exhausted;
    const hitCeiling = auditedTotal >= SANITY_BACKFILL_MAX_TOPICS;
    const done = exhausted || hitCeiling;
    if (done) {
      await (0, _settingService.setSetting)(DONE_KEY, String(now));
      _logger.default.debug('[sanity-backfill] complete', {
        auditedTotal,
        reason: exhausted ? 'exhausted' : 'ceiling'
      });
    }
    return {
      ran: true,
      audited: result.audited,
      proposalsAdded,
      done
    };
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'sanity-backfill-service',
        method: 'runSanityBackfillChunk'
      }
    });
    // Deliberately NOT marking done — a failed chunk is retried next tick.
    return {
      ran: false,
      audited: 0,
      proposalsAdded: 0,
      done: false
    };
  }
}