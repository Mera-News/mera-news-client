"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createJob = createJob;
exports.loadLastRunTimes = loadLastRunTimes;
exports.markCompleted = markCompleted;
exports.markFailed = markFailed;
exports.markRunning = markRunning;
exports.markStaleCrashedJobs = markStaleCrashedJobs;
exports.modelToJob = modelToJob;
exports.pruneOldJobs = pruneOldJobs;
exports.saveLastRun = saveLastRun;
var _watermelondb = require("@nozbe/watermelondb");
var _database = _interopRequireDefault(require("../database"));
var _settingService = require("../database/services/setting-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const LAST_RUN_PREFIX = 'scheduler_last_run_';
const STALE_JOB_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

function jobId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
function modelToJob(m) {
  return {
    id: m.id,
    taskName: m.taskName,
    status: m.status,
    input: m.inputJson ? JSON.parse(m.inputJson) : undefined,
    attempt: m.attempt,
    maxAttempts: m.maxAttempts,
    scheduledAt: m.scheduledAt,
    startedAt: m.startedAt ?? undefined,
    completedAt: m.completedAt ?? undefined,
    retryAt: m.retryAt ?? undefined,
    errorCode: m.errorCode ?? undefined,
    errorMessage: m.errorMessage ?? undefined
  };
}

/**
 * @param attempt Which attempt this job is. Defaults to 1.
 *
 *   Load-bearing, and it used to be hardcoded to 1. The runner's retry ladder
 *   reschedules through `AppScheduler.trigger()`, which lands back here — so a
 *   retry minted a fresh job at attempt 1, `job.attempt >= maxAttempts` was
 *   never true, and the documented "3 attempts, then give up" ladder was in
 *   fact an unbounded 30-second retry loop stopped only by a non-retryable
 *   error. Any future path that creates a job for a RETRY must pass this.
 */
async function createJob(task, input, attempt = 1) {
  const id = jobId();
  const now = Date.now();
  await _database.default.write(async () => {
    await _database.default.get('scheduler_jobs').create(record => {
      record._raw.id = id;
      record.taskName = task.name;
      record.status = 'pending';
      record.inputJson = input !== undefined ? JSON.stringify(input) : null;
      record.errorCode = null;
      record.errorMessage = null;
      record.attempt = attempt;
      record.maxAttempts = task.maxAttempts ?? 3;
      record.scheduledAt = now;
      record.startedAt = null;
      record.completedAt = null;
      record.retryAt = null;
    });
  });
  return {
    id,
    taskName: task.name,
    status: 'pending',
    input,
    attempt,
    maxAttempts: task.maxAttempts ?? 3,
    scheduledAt: now
  };
}
async function markRunning(jobId) {
  const rows = await _database.default.get('scheduler_jobs').query(_watermelondb.Q.where('id', jobId)).fetch();
  if (rows.length === 0) return;
  await _database.default.write(async () => {
    await rows[0].update(r => {
      r.status = 'running';
      r.startedAt = Date.now();
    });
  });
}
async function markCompleted(jobId, completedAt) {
  const rows = await _database.default.get('scheduler_jobs').query(_watermelondb.Q.where('id', jobId)).fetch();
  if (rows.length === 0) return;
  await _database.default.write(async () => {
    await rows[0].update(r => {
      r.status = 'completed';
      r.completedAt = completedAt;
    });
  });
}
async function markFailed(jobId, err, exhausted, retryAt) {
  const rows = await _database.default.get('scheduler_jobs').query(_watermelondb.Q.where('id', jobId)).fetch();
  if (rows.length === 0) return;
  const msg = err instanceof Error ? err.message : String(err);
  await _database.default.write(async () => {
    await rows[0].update(r => {
      r.status = exhausted ? 'failed' : 'retrying';
      r.errorMessage = msg;
      r.retryAt = retryAt ?? null;
    });
  });
}
async function saveLastRun(taskName, ts) {
  await (0, _settingService.setSetting)(`${LAST_RUN_PREFIX}${taskName}`, String(ts));
}
async function loadLastRunTimes(taskNames) {
  const result = {};
  for (const name of taskNames) {
    const raw = await (0, _settingService.getSetting)(`${LAST_RUN_PREFIX}${name}`);
    if (raw) result[name] = Number(raw);
  }
  return result;
}
async function markStaleCrashedJobs() {
  const cutoff = Date.now() - STALE_JOB_AGE_MS;
  const rows = await _database.default.get('scheduler_jobs').query(_watermelondb.Q.where('status', 'running')).fetch();
  const stale = rows.filter(r => (r.startedAt ?? 0) < cutoff);
  if (stale.length === 0) return;
  await _database.default.write(async () => {
    await Promise.all(stale.map(r => r.update(rec => {
      rec.status = 'stale';
    })));
  });
}
async function pruneOldJobs(olderThanMs = 7 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - olderThanMs;
  // Retrying jobs whose retry_at is more than STALE_JOB_AGE_MS in the past
  // are effectively dead — their setTimeout was lost when the app was killed.
  // pruneOldJobs is the only cleanup path for these since markStaleCrashedJobs
  // only targets 'running' status.
  const deadRetryCutoff = Date.now() - STALE_JOB_AGE_MS;
  const rows = await _database.default.get('scheduler_jobs').query(_watermelondb.Q.or(_watermelondb.Q.and(_watermelondb.Q.where('status', _watermelondb.Q.oneOf(['completed', 'failed', 'stale'])), _watermelondb.Q.where('scheduled_at', _watermelondb.Q.lt(cutoff))), _watermelondb.Q.and(_watermelondb.Q.where('status', 'retrying'), _watermelondb.Q.where('retry_at', _watermelondb.Q.lt(deadRetryCutoff))))).fetch();
  if (rows.length === 0) return;
  await _database.default.write(async () => {
    await Promise.all(rows.map(r => r.destroyPermanently()));
  });
}