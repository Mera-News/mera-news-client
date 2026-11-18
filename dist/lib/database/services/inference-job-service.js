"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.countActiveJobsExcluding = countActiveJobsExcluding;
exports.dequeueJob = dequeueJob;
exports.enqueueJob = enqueueJob;
exports.getActiveTopicGenFactIds = getActiveTopicGenFactIds;
exports.getFailedJobs = getFailedJobs;
exports.getQueueStats = getQueueStats;
exports.hasPendingJob = hasPendingJob;
exports.pruneCompletedJobs = pruneCompletedJobs;
exports.purgeFailedJobs = purgeFailedJobs;
exports.recoverCrashedJobs = recoverCrashedJobs;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Inference Job Service — CRUD for the persistent inference queue.

const jobsCollection = _index.default.get('inference_jobs');

/** Default priority: lower = higher priority. */
const DEFAULT_PRIORITY = {
  topic_gen: 10,
  // Lower priority than topic_gen (summary depends on topics existing, and it's
  // a background nicety — never block topic generation on it).
  persona_summary: 20,
  // Naming a followed story — a background nicety like persona_summary. Runs at
  // the same low priority so it never contends with topic generation.
  story_headline: 20,
  // Migrating a legacy follow to the topic model — a background nicety, same low
  // priority as story_headline so it never contends with topic generation.
  tracked_story_migrate: 20,
  // One fact of the deferred combination pass. Behind topic_gen (10) so the
  // isolated topics a chat just saved drain first, ahead of the niceties.
  topic_combo: 15
};
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Enqueue a new inference job. Returns the created record's ID.
 */
async function enqueueJob(jobType, payload, opts) {
  let createdId = '';
  await _index.default.write(async () => {
    const record = await jobsCollection.create(job => {
      job.jobType = jobType;
      job.status = 'pending';
      job.priority = opts?.priority ?? DEFAULT_PRIORITY[jobType];
      job.payload = payload;
      job.attempts = 0;
      job.maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    });
    createdId = record.id;
  });
  return createdId;
}

/**
 * Dequeue the next pending job (lowest priority number = highest priority, then oldest).
 * Returns null if no pending jobs.
 *
 * `excludeTypes` is the queue's in-memory DEFER gate. It must remove the type
 * from the query itself, not be checked after it: this takes only the head row,
 * so a deferred job skipped after the fact would still be the head on every
 * poll and would starve every lower-priority job behind it.
 */
async function dequeueJob(opts) {
  const excluded = opts?.excludeTypes ?? [];
  const pending = await jobsCollection.query(_watermelondb.Q.where('status', 'pending'), ...(excluded.length > 0 ? [_watermelondb.Q.where('job_type', _watermelondb.Q.notIn(excluded))] : []), _watermelondb.Q.sortBy('priority', _watermelondb.Q.asc), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.asc), _watermelondb.Q.take(1)).fetch();
  return pending.length > 0 ? pending[0] : null;
}

/**
 * Recover crashed jobs — reset any 'running' jobs back to 'pending'.
 * Called on app startup to recover from crashes.
 */
async function recoverCrashedJobs() {
  const running = await jobsCollection.query(_watermelondb.Q.where('status', 'running')).fetch();
  if (running.length === 0) return 0;
  await _index.default.write(async () => {
    const batch = running.map(job => job.prepareUpdate(j => {
      // If max attempts reached, mark as failed instead of retrying
      if (j.attempts >= j.maxAttempts) {
        j.status = 'failed';
        j.errorMessage = 'Crashed during execution (max attempts reached)';
      } else {
        j.status = 'pending';
      }
    }));
    await _index.default.batch(batch);
  });
  return running.length;
}

/**
 * Get count of pending + running jobs, for progress tracking.
 */
async function getQueueStats() {
  const [pending, running, failed] = await Promise.all([jobsCollection.query(_watermelondb.Q.where('status', 'pending')).fetchCount(), jobsCollection.query(_watermelondb.Q.where('status', 'running')).fetchCount(), jobsCollection.query(_watermelondb.Q.where('status', 'failed')).fetchCount()]);
  return {
    pending,
    running,
    failed
  };
}

/**
 * Fetch failed jobs for diagnostic logging.
 */
async function getFailedJobs() {
  const records = await jobsCollection.query(_watermelondb.Q.where('status', 'failed')).fetch();
  return records.map(r => ({
    id: r.id,
    jobType: r.jobType,
    errorMessage: r.errorMessage ?? null,
    attempts: r.attempts,
    payload: r.payload
  }));
}

/**
 * Prune completed and failed jobs older than the given date.
 */
async function pruneCompletedJobs(olderThan) {
  const old = await jobsCollection.query(_watermelondb.Q.where('status', _watermelondb.Q.oneOf(['done', 'failed'])), _watermelondb.Q.where('updated_at', _watermelondb.Q.lt(olderThan.getTime()))).fetch();
  if (old.length === 0) return 0;
  await _index.default.write(async () => {
    const batch = old.map(j => j.prepareDestroyPermanently());
    await _index.default.batch(batch);
  });
  return old.length;
}

/**
 * Delete all failed jobs immediately.
 */
async function purgeFailedJobs() {
  const failed = await jobsCollection.query(_watermelondb.Q.where('status', 'failed')).fetch();
  if (failed.length === 0) return 0;
  await _index.default.write(async () => {
    const batch = failed.map(j => j.prepareDestroyPermanently());
    await _index.default.batch(batch);
  });
  return failed.length;
}

/**
 * Check if a duplicate job already exists (pending or running) with the same type and a matching payload key.
 * Used to avoid enqueueing duplicate topic_gen jobs for the same fact.
 */
async function hasPendingJob(jobType, matchKey, matchValue) {
  const candidates = await jobsCollection.query(_watermelondb.Q.where('job_type', jobType), _watermelondb.Q.where('status', _watermelondb.Q.oneOf(['pending', 'running']))).fetch();
  const exists = candidates.some(job => {
    const payload = job.payload;
    return payload[matchKey] === matchValue;
  });
  return exists;
}

/**
 * Return the set of fact IDs that still have pending or running topic_gen jobs.
 * Used by the startup orphan-fact sweep to avoid prematurely marking facts
 * as failed while their generation is still queued/running.
 */
async function getActiveTopicGenFactIds() {
  const active = await jobsCollection.query(_watermelondb.Q.where('job_type', 'topic_gen'), _watermelondb.Q.where('status', _watermelondb.Q.oneOf(['pending', 'running']))).fetch();
  const factIds = new Set();
  for (const job of active) {
    const factId = job.payload?.factId;
    if (typeof factId === 'string') factIds.add(factId);
  }
  return factIds;
}

/**
 * Pending + running jobs of every type EXCEPT `types`. The queue's drain check:
 * `onDrain` callers wait for their own work (a fact's "generating more"), and
 * a combination pass behind it, which can sit deferred for as long as the
 * device is offline, must not hold that spinner up.
 */
async function countActiveJobsExcluding(types) {
  const rows = await jobsCollection.query(_watermelondb.Q.where('status', _watermelondb.Q.oneOf(['pending', 'running'])), ...(types.length > 0 ? [_watermelondb.Q.where('job_type', _watermelondb.Q.notIn(types))] : [])).fetch();
  return rows.filter(j => (j.status === 'pending' || j.status === 'running') && !types.includes(j.jobType)).length;
}