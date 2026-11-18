"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FACTS_COMBO_PENDING_KEY = exports.COMBO_SIBLING_LIMIT = exports.COMBO_JOB_TYPE = exports.COMBO_JOB_PRIORITY = void 0;
exports.__resetComboPassForTests = __resetComboPassForTests;
exports.applyComboTopicsForFact = applyComboTopicsForFact;
exports.claimSiblings = claimSiblings;
exports.countActiveComboJobs = countActiveComboJobs;
exports.dropPendingComboJobs = dropPendingComboJobs;
exports.enqueueComboPass = enqueueComboPass;
exports.finishComboPassIfDrained = finishComboPassIfDrained;
exports.isComboPending = isComboPending;
exports.markComboPending = markComboPending;
exports.newComboPassId = newComboPassId;
exports.observeActiveComboJobCount = observeActiveComboJobCount;
exports.precheckComboJob = precheckComboJob;
exports.readProcessingModeSetting = readProcessingModeSetting;
exports.releaseComboJobs = releaseComboJobs;
exports.runEndOfPassRefresh = runEndOfPassRefresh;
exports.runPendingComboPass = runPendingComboPass;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
var _graphqlTypes = require("../../generated/graphql-types");
var _config = require("../../news-harness/core/config");
var _factService = require("./fact-service");
var _settingService = require("./setting-service");
var _topicService = require("./topic-service");
var _topicDeclineService = require("./topic-decline-service");
var _articleSuggestionLifecycle = require("./article-suggestion-lifecycle");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Combo Pass Service — the data side of the deferred, resumable combination
// pass.
//
// Topic generation for a fact is ISOLATED: it reads that fact alone. The
// topics that only exist because two facts sit side by side ("Dutch tax rules
// for Indian expats") come from a separate pass that runs later, once per fact,
// as `topic_combo` jobs in the persistent inference queue. Being queue jobs is
// what makes the pass resumable: a kill mid-pass leaves rows on disk, and
// `recoverCrashedJobs` + the next foreground pick them up.
//
// Lifecycle:
//   1. Something marks the persona as changed: `markComboPending()` (the
//      Profile chat closing with edits, or a kill caught on the next launch).
//   2. `runPendingComboPass()` turns the flag into N jobs in ONE batch that
//      also clears the flag (`enqueueComboPass`). Cloud mode only; on-device
//      skips straight to the end-of-pass refresh.
//   3. The handler (lib/inference/handlers/topic-combo-handler.ts, chat area)
//      claims same-pass siblings (`claimSiblings`), makes one batched cloud
//      call and writes each fact with `applyComboTopicsForFact`, which marks
//      that fact's job done in the same batch as its topic writes.
//   4. The queue calls `finishComboPassIfDrained()` after every combo job
//      settles; the last one runs `pruneOrphanedData` + a feed sync.
//
// Deferral (offline / no credential / 503 / 429) lives in the queue and
// lib/inference/job-defer.ts; `precheckComboJob` is the part it asks first.

/** Set when the persona changed and a combination pass is owed. Not backed up
 *  (settings back up by allowlist), which is right: a restore re-runs nothing. */
const FACTS_COMBO_PENDING_KEY = exports.FACTS_COMBO_PENDING_KEY = 'facts_combo_pending';
/** Same row the Mera Protocol store persists. Read HERE, not from the store:
 *  the queue and the recover task run before `hydrateAllStores` finishes, when
 *  the store still holds its CLOUD default. */
const PROCESSING_MODE_KEY = 'mera_processing_mode';
const COMBO_JOB_TYPE = exports.COMBO_JOB_TYPE = 'topic_combo';
/** Behind topic_gen (10): the isolated topics a chat just saved drain first. */
const COMBO_JOB_PRIORITY = exports.COMBO_JOB_PRIORITY = 15;
/** Siblings per handler run: the gateway's batch concurrency. */
const COMBO_SIBLING_LIMIT = exports.COMBO_SIBLING_LIMIT = 8;
const COMBO_MAX_ATTEMPTS = 3;
const jobsCollection = _index.default.get('inference_jobs');
const topicsCollection = _index.default.get('topics');
const factsCollection = _index.default.get('facts');
const settingsCollection = _index.default.get('settings');
const ACTIVE = ['pending', 'running'];
function isCombo(j) {
  return j.jobType === COMBO_JOB_TYPE;
}
function payloadOf(j) {
  return j.payload ?? {};
}
function newComboPassId() {
  return `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Settings ───────────────────────────────────────────────────────────────

/** The row for `key`, matched in JS as well as SQL so a stray row never
 *  answers for another key. */
async function settingRows(key) {
  const rows = await settingsCollection.query(_watermelondb.Q.where('key', key)).fetch();
  return rows.filter(r => r.key === key);
}
async function markComboPending() {
  await (0, _settingService.setSetting)(FACTS_COMBO_PENDING_KEY, String(Date.now()));
}
async function isComboPending() {
  const [row] = await settingRows(FACTS_COMBO_PENDING_KEY);
  return !!row?.value;
}
async function clearComboPending() {
  await _index.default.write(async () => {
    const rows = await settingRows(FACTS_COMBO_PENDING_KEY);
    for (const r of rows) await r.destroyPermanently();
  });
}

/** Processing mode from the SETTINGS row. Absent or unrecognised means cloud,
 *  the store's own default. */
async function readProcessingModeSetting() {
  const [row] = await settingRows(PROCESSING_MODE_KEY);
  return row?.value === _graphqlTypes.ProcessingMode.OnDevice ? _graphqlTypes.ProcessingMode.OnDevice : _graphqlTypes.ProcessingMode.Cloud;
}

// ── Enqueue / claim / release / drop ──────────────────────────────────────

/**
 * Create one `topic_combo` job per fact AND clear the pending flag, in ONE
 * batch: a kill between the two would either lose the pass (flag cleared, no
 * jobs) or run it twice (jobs, flag still set).
 *
 * A new pass SUPERSEDES an earlier one: that pass's still-pending jobs are
 * destroyed in the same batch (each fact is about to be recomputed against the
 * newer persona anyway). Running jobs are left to finish.
 */
async function enqueueComboPass(factIds, passId = newComboPassId()) {
  const unique = [...new Set(factIds.filter(id => typeof id === 'string' && id.length > 0))];
  let jobIds = [];
  await _index.default.write(async () => {
    const [flagRows, candidates] = await Promise.all([settingRows(FACTS_COMBO_PENDING_KEY), jobsCollection.query(_watermelondb.Q.where('job_type', COMBO_JOB_TYPE), _watermelondb.Q.where('status', 'pending')).fetch()]);
    const superseded = candidates.filter(j => isCombo(j) && j.status === 'pending');
    const creates = unique.map(factId => jobsCollection.prepareCreate(j => {
      j.jobType = COMBO_JOB_TYPE;
      j.status = 'pending';
      j.priority = COMBO_JOB_PRIORITY;
      j.payload = {
        factId,
        passId
      };
      j.attempts = 0;
      j.maxAttempts = COMBO_MAX_ATTEMPTS;
    }));
    await _index.default.batch([...superseded.map(j => j.prepareDestroyPermanently()), ...creates, ...flagRows.map(r => r.prepareDestroyPermanently())]);
    jobIds = creates.map(c => c.id);
  });
  return {
    passId,
    jobIds
  };
}

/**
 * Claim up to `limit` PENDING jobs of the same pass for one batched call:
 * marked running with an attempt counted, in one batch. The caller MUST give
 * them back with `releaseComboJobs` if it throws before applying them; only
 * `InferenceQueue.start()` resets running jobs, so a sibling left running
 * holds the toast up and the end of the pass back for the whole session.
 */
async function claimSiblings(passId, limit = COMBO_SIBLING_LIMIT) {
  if (limit <= 0) return [];
  const rows = await jobsCollection.query(_watermelondb.Q.where('job_type', COMBO_JOB_TYPE), _watermelondb.Q.where('status', 'pending'), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.asc)).fetch();
  const picked = rows.filter(j => isCombo(j) && j.status === 'pending' && payloadOf(j).passId === passId).slice(0, limit);
  if (picked.length === 0) return [];
  await _index.default.write(async () => {
    await _index.default.batch(picked.map(j => j.prepareUpdate(row => {
      row.status = 'running';
      row.attempts = (row.attempts || 0) + 1;
    })));
  });
  return picked.map(j => ({
    jobId: j.id,
    factId: String(payloadOf(j).factId ?? '')
  }));
}

/**
 * Give claimed siblings back. `'defer'` re-pends them and returns the attempt
 * the claim took (the conditions were wrong, not the job); `{ error }` keeps
 * the attempt and follows `markFailed`: destroyed at max attempts, else pending.
 */
async function releaseComboJobs(jobIds, outcome) {
  if (jobIds.length === 0) return;
  const rows = (await jobsCollection.query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf(jobIds))).fetch()).filter(j => jobIds.includes(j.id) && j.status === 'running');
  if (rows.length === 0) return;
  await _index.default.write(async () => {
    await _index.default.batch(rows.map(j => {
      if (outcome === 'defer') {
        return j.prepareUpdate(row => {
          row.status = 'pending';
          row.attempts = Math.max(0, (row.attempts || 0) - 1);
          row.errorMessage = 'deferred';
        });
      }
      if ((j.attempts || 0) >= j.maxAttempts) return j.prepareDestroyPermanently();
      return j.prepareUpdate(row => {
        row.status = 'pending';
        row.errorMessage = outcome.error;
      });
    }));
  });
}

/** Destroy every PENDING combo job (the mode switched to on-device mid-pass).
 *  A running one finishes; its apply is still correct. */
async function dropPendingComboJobs() {
  const rows = (await jobsCollection.query(_watermelondb.Q.where('job_type', COMBO_JOB_TYPE), _watermelondb.Q.where('status', 'pending')).fetch()).filter(j => isCombo(j) && j.status === 'pending');
  if (rows.length === 0) return 0;
  await _index.default.write(async () => {
    await _index.default.batch(rows.map(j => j.prepareDestroyPermanently()));
  });
  return rows.length;
}
function activeComboQuery() {
  return jobsCollection.query(_watermelondb.Q.where('job_type', COMBO_JOB_TYPE), _watermelondb.Q.where('status', _watermelondb.Q.oneOf(ACTIVE)));
}

/** Pending + running combo jobs. */
async function countActiveComboJobs() {
  const rows = await activeComboQuery().fetch();
  return rows.filter(j => isCombo(j) && ACTIVE.includes(j.status)).length;
}

/** Live count of pending + running combo jobs, for the "Updating all facts"
 *  toast. From the DB, so it survives a kill. */
function observeActiveComboJobCount() {
  // UNTHROTTLED on purpose: the default observeCount() throttles leading-only, so a job marked done within 250ms of the previous write is dropped and the count never reaches 0.
  return activeComboQuery().observeCount(false);
}

// ── The per-fact diff ──────────────────────────────────────────────────────

/**
 * Write one fact's combination topics as a DIFF against that fact's
 * `provenance: 'combo'` rows, in one write that also marks `jobId` done.
 *
 * - Returned texts that match an existing combo row KEEP that row (id, weight
 *   and signals survive).
 * - Rows staged for deletion (`pending_delete_at`) are left alone, and their
 *   text is never re-minted (it is in the existing-text veto, and was declined).
 * - A stale combo row a `tracked_stories.topic_id` points at is RETIRED, never
 *   destroyed: the FK would dangle and that story would stop matching forever.
 * - A stale combo row the user suppressed or down-ranked (weight < 0) is left:
 *   destroying it would erase the user's own filter.
 * - Every other stale combo row is destroyed; new texts are inserted after the
 *   FULL declined list and every normalized text on the device veto them.
 * - `fact.metadata.topics` is pruned and appended in the same batch.
 * - Non-combo rows are never read into the diff, so never touched.
 * - A deleted fact is a no-op that still marks the job done.
 */
async function applyComboTopicsForFact(factId, texts, jobId) {
  const result = {
    kept: 0,
    inserted: 0,
    retired: 0,
    destroyed: 0
  };
  const job = await jobsCollection.find(jobId).catch(() => null);
  const markDone = r => job ? [job.prepareUpdate(j => {
    j.status = 'done';
    j.result = {
      ...r
    };
  })] : [];
  const fact = await factsCollection.find(factId).catch(() => null);
  if (!fact) {
    if (job) {
      await _index.default.write(async () => {
        await _index.default.batch(markDone(result));
      });
    }
    return result;
  }

  // Returned texts, deduped by key, first spelling wins.
  const returned = [];
  const returnedKeys = new Set();
  for (const raw of texts) {
    const text = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
    const key = (0, _topicService.normalizeTopicText)(text);
    if (!key || returnedKeys.has(key)) continue;
    returnedKeys.add(key);
    returned.push({
      text,
      key
    });
  }
  const owned = (await topicsCollection.query(_watermelondb.Q.where('fact_id', factId)).fetch()).filter(t => t.factId === factId);
  const combo = owned.filter(t => t.provenance === 'combo' && t.pendingDeleteAt == null);
  const kept = combo.filter(t => returnedKeys.has(t.normalizedText));
  const stale = combo.filter(t => !returnedKeys.has(t.normalizedText) && t.status !== 'suppressed' && !(typeof t.weight === 'number' && t.weight < 0));
  const trackedRows = stale.length > 0 ? await _index.default.get('tracked_stories').query(_watermelondb.Q.where('topic_id', _watermelondb.Q.oneOf(stale.map(t => t.id)))).fetch() : [];
  const guarded = new Set(trackedRows.map(r => r.topicId ?? '').filter(Boolean));
  const toRetire = stale.filter(t => guarded.has(t.id));
  const toDestroy = stale.filter(t => !guarded.has(t.id));
  const [declined, existing] = await Promise.all([(0, _topicDeclineService.getAllDeclinedNormalizedTexts)(), (0, _topicService.getAllNormalizedTexts)()]);
  const keptKeys = new Set(kept.map(t => t.normalizedText));
  const toInsert = returned.filter(r => !keptKeys.has(r.key) && !declined.has(r.key) && !existing.has(r.key));
  result.kept = kept.length;
  result.inserted = toInsert.length;
  result.retired = toRetire.filter(t => t.status !== 'retired').length;
  result.destroyed = toDestroy.length;

  // metadata.topics: drop texts no surviving row of this fact still carries,
  // then append the new ones. Same key both ways (normalizeTopicText).
  const removed = new Set([...toRetire, ...toDestroy].map(t => t.id));
  const survivorKeys = new Set(owned.filter(t => !removed.has(t.id)).map(t => t.normalizedText));
  const dropKeys = new Set([...toRetire, ...toDestroy].map(t => t.normalizedText).filter(k => !survivorKeys.has(k)));
  const current = fact.metadata ?? {};
  const before = Array.isArray(current.topics) ? current.topics : [];
  const nextTopics = before.filter(t => !dropKeys.has((0, _topicService.normalizeTopicText)(t)));
  const seen = new Set(nextTopics.map(t => (0, _topicService.normalizeTopicText)(t)));
  for (const r of toInsert) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    nextTopics.push(r.text);
  }
  const metadataChanged = nextTopics.length !== before.length || nextTopics.some((t, i) => t !== before[i]);
  const now = new Date();
  await _index.default.write(async () => {
    const creates = toInsert.map(r => topicsCollection.prepareCreate(t => {
      t.factId = factId;
      t.text = r.text;
      t.normalizedText = r.key;
      // Speculative combinations the user never asked for: the lower top-up
      // seed, so each costs less retrieval depth. Never 0, which is a topic
      // buildRetrievalProfile silently never queries.
      t.weight = _config.DEFAULT_HARNESS_CONFIG.topicGen.topupTopicWeight;
      t.status = 'active';
      t.provenance = 'combo';
      t.highPriority = false;
      t.locationId = null;
      t.lastSignalAt = null;
      t.createdAt = now;
      t.updatedAt = now;
    }));
    const retires = toRetire.filter(t => t.status !== 'retired').map(t => t.prepareUpdate(row => {
      row.status = 'retired';
      row.updatedAt = now;
    }));
    const factUpdate = metadataChanged ? [fact.prepareUpdate(f => {
      // Spread `current`: `{ topics }` alone would drop topicGenError
      // and topicsReviewedAt.
      f.metadata = {
        ...current,
        topics: nextTopics
      };
      f.updatedAt = now;
    })] : [];
    await _index.default.batch([...creates, ...retires, ...toDestroy.map(t => t.prepareDestroyPermanently()), ...factUpdate, ...markDone(result)]);
  });

  // A destroy changes the topic-id liveness set; suggestions only this topic
  // retrieved are now dead weight. After the write, never inside it.
  if (toDestroy.length > 0) {
    try {
      await (0, _articleSuggestionLifecycle.purgeSuggestionsForDeadTopics)(await (0, _topicService.getAllTopicIds)());
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          service: 'combo-pass',
          method: 'applyComboTopicsForFact:purge'
        }
      });
    }
  }
  return result;
}

// ── Pre-check, run, end of pass ────────────────────────────────────────────

function hasLocalSessionCredential() {
  try {
    // Lazy: auth-client drags native modules into every importer's suite.
    const {
      authClient
    } = require("../../platform/auth");
    const cookie = authClient.getCookie();
    return typeof cookie === 'string' && cookie.length > 0;
  } catch {
    return false; // a locked keychain reads as "not yet"
  }
}
function isConfirmedOffline() {
  try {
    const {
      useNetworkStore
    } = require("../../stores/network-store");
    return useNetworkStore.getState().isConnected === false;
  } catch {
    return false;
  }
}

/**
 * Asked by the queue BEFORE it claims a combo job, so no attempt is spent:
 * - `'drop'`: on-device mode (read from the setting), the pass does not apply;
 * - `'defer'`: confirmed offline, or no local session credential yet;
 * - `'run'`: otherwise.
 */
async function precheckComboJob() {
  if ((await readProcessingModeSetting()) !== _graphqlTypes.ProcessingMode.Cloud) return 'drop';
  if (isConfirmedOffline()) return 'defer';
  if (!hasLocalSessionCredential()) return 'defer';
  return 'run';
}
let refreshInFlight = null;

/**
 * What the Profile "Refresh suggestions" button used to do: drop suggestions
 * no topic owns any more, then sync. The sync is fired, not awaited
 * (`trigger` awaits the whole run, and the queue loop calls this). Latched so
 * two settles landing together refresh once.
 */
function runEndOfPassRefresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const {
        useForYouStore
      } = require("../../stores/for-you-store");
      await useForYouStore.getState().pruneOrphanedData();
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          service: 'combo-pass',
          method: 'prune'
        }
      });
    }
    try {
      const {
        AppScheduler
      } = require("../../scheduler/AppScheduler");
      void AppScheduler.trigger('feed-sync').catch(err => _logger.default.warn('[combo-pass] feed-sync trigger failed', {
        error: String(err)
      }));
    } catch (err) {
      _logger.default.captureException(err, {
        tags: {
          service: 'combo-pass',
          method: 'feed-sync'
        }
      });
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Called by the queue after every combo job settles (done, destroyed or
 *  dropped). Runs the end-of-pass refresh when none is pending or running. */
async function finishComboPassIfDrained() {
  if ((await countActiveComboJobs()) > 0) return false;
  await runEndOfPassRefresh();
  return true;
}

/**
 * Turn the pending flag into a pass. Cloud: one job per fact, then wake the
 * queue. On-device, or no facts left: no pass, clear the flag and refresh.
 */
async function runPendingComboPass() {
  if (!(await isComboPending())) return 'none';
  const mode = await readProcessingModeSetting();
  const facts = await (0, _factService.getFacts)();
  if (mode !== _graphqlTypes.ProcessingMode.Cloud || facts.length === 0) {
    await clearComboPending();
    await runEndOfPassRefresh();
    return 'refreshed';
  }
  await enqueueComboPass(facts.map(f => f.id));
  // Lazy: InferenceQueue imports this module.
  const {
    inferenceQueue
  } = require("../../inference/InferenceQueue");
  inferenceQueue.notify();
  return 'enqueued';
}

/** Test seam: drop the refresh latch. */
function __resetComboPassForTests() {
  refreshInFlight = null;
}