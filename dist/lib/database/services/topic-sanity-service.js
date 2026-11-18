"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.commitSanityCursor = commitSanityCursor;
exports.resetSanityCursor = resetSanityCursor;
exports.runSanityAudit = runSanityAudit;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
var _cloudComplete = require("../../llm/cloudComplete");
var _onDeviceGate = require("../../llm/on-device-gate");
var _loggerAdapter = require("../../news-harness-app/logger-adapter");
var _topicSanity = require("../../news-harness/persona-management/topic-sanity");
var _settingService = require("./setting-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Topic Sanity Service — RN adapter for the LLM topic-sanity audit.
//
// Asks whether each already-minted topic genuinely belongs to the fact that owns
// it, so the combo-prompt contamination ("Amsterdam cricket festival music
// tech") is cleaned up and not merely prevented going forward. Verdicts become
// `incoherent_topics` hygiene proposals — one per FACT — which the user accepts
// or dismisses in the existing review sheet. Nothing here mutates a topic.
//
// All decidable logic (selection, batching, prompt rendering, verdict decoding)
// is pure and lives in lib/news-harness/persona-management/topic-sanity.ts. This
// file supplies live rows, applies the exclusions that need the database, issues
// the batch call, and advances the cursor.

const topicsCollection = _index.default.get('topics');
const trackedStoriesCollection = _index.default.get('tracked_stories');

/** Monotonic audit cursor (epoch ms). A topic's `created_at` is stamped at mint
 *  and its text never changes, so nothing can appear BEHIND the cursor — this is
 *  equivalent to a per-row "audited" flag for every row not yet seen, with no
 *  schema change. Resetting it to 0 re-audits the whole corpus. */
const CURSOR_KEY = 'sanity_audited_through_ms';

/** Consecutive runs that had a failed prompt and could not move the cursor.
 *  Stored beside the cursor; any forward move resets it. */
const STALL_KEY = 'sanity_cursor_stall_count';

/** A prompt the model refuses every time holds the cursor just below its
 *  topics. After this many stalled runs the audit gives up on those topics and
 *  moves past them, so one refusing prompt cannot pin the pass forever. */
const SANITY_STALL_LIMIT = 3;

/**
 * Provenances the audit will never judge.
 *  - `tracked`  — backs a followed story; Area I is about to make it
 *                 billing-relevant (quota-exempt hydration), so retiring one
 *                 would both break the follow and change how it is charged.
 *  - `user`     — the user typed it. Mera does not second-guess that.
 */
const EXCLUDED_PROVENANCE = new Set(['tracked', 'user']);
const EMPTY = {
  incoherentFacts: [],
  audited: 0,
  skipped: false,
  exhausted: false,
  nextCursorMs: null,
  stallCount: null
};

/** A run that never happened. Distinct from EMPTY — see `skipped`. */
const SKIPPED = {
  ...EMPTY,
  skipped: true
};
async function readCursor() {
  const raw = Number(await (0, _settingService.getSetting)(CURSOR_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Reset the audit cursor so the whole corpus is re-judged. Used by the
 *  one-time backfill after the generation prompt was fixed. */
async function resetSanityCursor() {
  await (0, _settingService.setSetting)(CURSOR_KEY, '0');
  await (0, _settingService.setSetting)(STALL_KEY, '0');
}
async function readStall() {
  const raw = Number(await (0, _settingService.getSetting)(STALL_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** Move the audit cursor and store the stall counter. Called by the caller of
 *  `runSanityAudit` once the verdicts of that run are stored; a null field
 *  leaves its row alone. */
async function commitSanityCursor(audit) {
  if (audit.nextCursorMs !== null) await (0, _settingService.setSetting)(CURSOR_KEY, String(audit.nextCursorMs));
  if (audit.stallCount !== null) await (0, _settingService.setSetting)(STALL_KEY, String(audit.stallCount));
}

/**
 * Run one audit pass. Never throws — any failure yields zero verdicts, which the
 * sweep treats as "nothing to propose this week". The cursor is not moved here:
 * the caller commits `nextCursorMs` after it has stored the verdicts, so a
 * failed or raced-out run is retried intact.
 */
async function runSanityAudit(opts) {
  try {
    // On-device mode never calls the cloud AI. Reported as `skipped`, so the
    // sweep does not stamp its cooldown off a run that never happened.
    if (await (0, _onDeviceGate.isOnDeviceMode)()) return SKIPPED;
    const facts = opts?.facts ?? [];
    if (facts.length === 0) return EMPTY;
    const cursorMs = await readCursor();

    // Candidate rows: active, fact-owned, auditable provenance.
    const rows = await topicsCollection.query(_watermelondb.Q.where('status', 'active'), _watermelondb.Q.where('fact_id', _watermelondb.Q.notEq(null))).fetch();

    // Story-bound topics are excluded even if their provenance drifted — a
    // followed story matches suggestions by topic_id, so retiring one silently
    // stops it finding new articles.
    const storyBound = new Set((await trackedStoriesCollection.query().fetch()).map(s => s.topicId).filter(id => !!id));
    const candidates = rows.filter(t => t.factId !== null && !EXCLUDED_PROVENANCE.has(t.provenance) && !storyBound.has(t.id)).map(t => ({
      id: t.id,
      factId: t.factId,
      text: t.text,
      createdAtMs: t.createdAt instanceof Date ? t.createdAt.getTime() : 0
    }));
    const plan = (0, _topicSanity.planSanityBatches)(candidates, facts, cursorMs, {
      maxTopics: opts?.maxTopics
    });
    if (plan.calls.length === 0) return {
      ...EMPTY,
      exhausted: true
    };
    const results = await (0, _cloudComplete.cloudBatchComplete)(plan.calls);

    // Active-topic counts per fact — `fillTo` is the count BEFORE any retire, so
    // replacement generation restores the fact to its previous coverage.
    const activeByFact = new Map();
    for (const t of rows) {
      if (!t.factId) continue;
      activeByFact.set(t.factId, (activeByFact.get(t.factId) ?? 0) + 1);
    }
    const factIdByTopicId = new Map(candidates.map(c => [c.id, c.factId]));
    const createdAtById = new Map(candidates.map(c => [c.id, c.createdAtMs]));
    const resultById = new Map(results.map(r => [r.id, r]));
    const flaggedByFact = new Map();
    let audited = 0;
    let decodedMaxMs = 0;
    let failedMinMs = Infinity;
    for (const [callId, topicIds] of plan.topicIdsByCallId) {
      const res = resultById.get(callId);
      if (!res || res.error) {
        _logger.default.warn('[topic-sanity] batch half failed', {
          id: callId,
          error: res?.error ?? 'no result'
        });
        for (const topicId of topicIds) {
          failedMinMs = Math.min(failedMinMs, createdAtById.get(topicId) ?? 0);
        }
        continue;
      }
      audited += topicIds.length;
      for (const topicId of topicIds) {
        decodedMaxMs = Math.max(decodedMaxMs, createdAtById.get(topicId) ?? 0);
      }
      for (const topicId of (0, _topicSanity.decodeSanityVerdicts)(res.output, topicIds, _loggerAdapter.appHarnessLogger)) {
        const factId = factIdByTopicId.get(topicId);
        if (!factId) continue;
        const list = flaggedByFact.get(factId) ?? [];
        list.push(topicId);
        flaggedByFact.set(factId, list);
      }
    }

    // Only move once something actually decoded, and never to or past a failed
    // prompt's oldest topic (a same-millisecond neighbour that did decode is
    // simply judged twice, which the proposal fingerprints absorb).
    const next = Math.min(decodedMaxMs, failedMinMs - 1);
    let nextCursorMs = audited > 0 && next > cursorMs ? next : null;

    // A prompt that fails on every attempt would hold the cursor here forever.
    // An outage throws inside cloudBatchComplete and never reaches here; any
    // failed prompt here was refused by the batch, so a run where the cursor
    // could not move counts as stalled.
    const stalled = await readStall();
    let stallCount = null;
    if (nextCursorMs !== null) {
      stallCount = stalled > 0 ? 0 : null;
    } else if (failedMinMs !== Infinity) {
      stallCount = stalled + 1;
      if (stallCount >= SANITY_STALL_LIMIT) {
        nextCursorMs = plan.maxCreatedAtMs > cursorMs ? plan.maxCreatedAtMs : null;
        stallCount = 0;
      }
    }
    const incoherentFacts = [...flaggedByFact.entries()].map(([factId, topicIds]) => ({
      factId,
      topicIds: topicIds.sort(),
      fillTo: activeByFact.get(factId) ?? topicIds.length
    })).sort((a, b) => a.factId < b.factId ? -1 : a.factId > b.factId ? 1 : 0);
    return {
      incoherentFacts,
      audited,
      skipped: false,
      exhausted: false,
      nextCursorMs,
      stallCount
    };
  } catch (error) {
    // A missing E2EE keypair is a STATE, not a defect: the device has not
    // generated (or has cleared) its credential, so a billed batch could not
    // have been made. Duck-typed on the name, matching the suppression class in
    // lib/logger.ts, so this module does not import lib/e2ee either. Reported
    // as a breadcrumb and surfaced as `skipped` so the sweep withholds its
    // cooldown stamp instead of charging the user a week for it.
    if (error?.name === 'NoCredentialError') {
      _logger.default.addBreadcrumb('sanity audit skipped — device has no E2EE credential', 'topic-sanity-service', {
        method: 'runSanityAudit'
      }, 'info');
      return SKIPPED;
    }
    _logger.default.captureException(error, {
      tags: {
        service: 'topic-sanity-service',
        method: 'runSanityAudit'
      }
    });
    return EMPTY;
  }
}