"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PipelineStaleError = void 0;
exports.clearPipeline = clearPipeline;
exports.createPipeline = createPipeline;
exports.getPipeline = getPipeline;
exports.mutatePipeline = mutatePipeline;
var _logger = _interopRequireDefault(require("../../logger"));
var _secureStore = require("../../platform/secure-store");
var _asyncStorage = _interopRequireDefault(require("../../platform/async-storage"));
var _settingService = require("./setting-service");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Scoring-pipeline run store — persistent state for the multi-batch cloud
// scoring pipeline (~19 batches per run).
//
// Doctrine:
//   - Non-secret run/batch metadata lives in the unencrypted WatermelonDB
//     `settings` row (key `async_pipeline_run`) so it survives cold-start and a
//     submit → push → reconcile cycle that spans a process restart.
//   - The run-level E2EE private key (used to decrypt gateway responses on
//     reconcile) is sensitive, so it is kept OUT of the SQLite row and stored in
//     expo-secure-store (keychain, pinned via the adapter to
//     AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY — the accessibility a background
//     reconcile needs when it wakes from a silent push while the device is
//     locked). The secret is per-run and disposable: a lost key costs one
//     re-score, never user data.
//   - Prompt bodies (system/user text) are NEVER persisted. Persisting them
//     blew past Android's 2 MB per-row CursorWindow limit on large reason
//     batches (~960 KB JSON for 451 calls) in the single-slot design. Only ids
//     and decoded score maps live here; the reconciler re-derives everything
//     else from `candidateIds` order + the score maps.

const PIPELINE_KEY = 'async_pipeline_run';
// The run-level E2EE secret is kept out of the unencrypted `settings` row and
// stored in the keychain (see file header).
const PIPELINE_PRIVKEY_KEY = 'async_pipeline_privkey';

// Legacy keys from the single-slot async-job design, cleaned up once per
// process on first `getPipeline`. `async_inference_pending_job` +
// `async_inference_pending_job_privkey` were the old single-slot job's constants;
// `mera.cycle.capabilityToken` was the AsyncStorage key
// of the now-deleted `lib/llm/capability-token.ts` — kept here as a literal so
// the cleanup still purges installs that wrote it.
const LEGACY_PENDING_JOB_KEY = 'async_inference_pending_job';
const LEGACY_PENDING_JOB_PRIVKEY_KEY = 'async_inference_pending_job_privkey';
const LEGACY_CAPABILITY_TOKEN_KEY = 'mera.cycle.capabilityToken';
/**
 * Thrown by `mutatePipeline` when the cross-context compare-and-swap fails on
 * every attempt (another context kept winning the write race). Callers back
 * off and retry the whole read-modify-write on the next tick.
 */
class PipelineStaleError extends Error {
  constructor(attempts) {
    super(`PipelineStale: CAS failed after ${attempts} attempt(s)`);
    this.attempts = attempts;
    this.name = 'PipelineStaleError';
  }
}

// ---------------------------------------------------------------------------
// Legacy cleanup (once per process)
// ---------------------------------------------------------------------------
exports.PipelineStaleError = PipelineStaleError;
let legacyCleanupDone = false;

/**
 * Best-effort, run-once removal of the single-slot design's persisted state.
 * Individually try/caught so a keychain hiccup on one key never blocks the
 * others or throws into `getPipeline`.
 */
async function runLegacyCleanupOnce() {
  if (legacyCleanupDone) return;
  legacyCleanupDone = true;
  try {
    await (0, _settingService.deleteSetting)(LEGACY_PENDING_JOB_KEY);
  } catch (err) {
    _logger.default.warn(`[scoring-pipeline-store] legacy pending-job setting cleanup failed: ${String(err)}`);
  }
  try {
    await _secureStore.secureStore.deleteItemAsync(LEGACY_PENDING_JOB_PRIVKEY_KEY);
  } catch (err) {
    _logger.default.warn(`[scoring-pipeline-store] legacy pending-job privkey cleanup failed: ${String(err)}`);
  }
  try {
    await _asyncStorage.default.removeItem(LEGACY_CAPABILITY_TOKEN_KEY);
  } catch (err) {
    _logger.default.warn(`[scoring-pipeline-store] legacy capability-token cleanup failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Delete both the settings row and the keychain secret (row first). */
async function clearBoth() {
  await (0, _settingService.deleteSetting)(PIPELINE_KEY).catch(err => {
    _logger.default.captureException(err, {
      tags: {
        service: 'scoring-pipeline-store',
        step: 'clear-row'
      }
    });
  });
  await _secureStore.secureStore.deleteItemAsync(PIPELINE_PRIVKEY_KEY).catch(err => {
    _logger.default.captureException(err, {
      tags: {
        service: 'scoring-pipeline-store',
        step: 'clear-privkey'
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create the pipeline run. Writes the secret to the keychain FIRST, then the
 * settings row (so a crash between the two writes leaves a recoverable secret
 * rather than a metadata row pointing at a missing key — the mirror of
 * `getPipeline`'s "missing companion key ⇒ unrecoverable" rule).
 *
 * Throws if a run already exists — the caller must append batches via
 * `mutatePipeline` instead of overwriting a live run.
 */
async function createPipeline(run, privKeyHex) {
  const existing = await (0, _settingService.getSetting)(PIPELINE_KEY);
  if (existing) {
    throw new Error('A pipeline run already exists — use mutatePipeline to append batches.');
  }
  await _secureStore.secureStore.setItemAsync(PIPELINE_PRIVKEY_KEY, privKeyHex);
  const full = {
    ...run,
    schema: 3,
    version: 1
  };
  await (0, _settingService.setSetting)(PIPELINE_KEY, JSON.stringify(full));
}

/**
 * Read the current run + its keychain secret. Returns null when no run exists.
 *
 * Self-heals two corrupt states by clearing both stores (a lost key costs one
 * re-score, never user data):
 *   - settings row present but JSON unparseable, or
 *   - settings row present but the keychain secret is missing (partial write /
 *     OS eviction).
 * A transient keychain read error (locked device on background wake) is NOT
 * treated as "missing" — it returns null WITHOUT clearing, so the next
 * foreground wake retries.
 *
 * Also performs a one-time, best-effort cleanup of the legacy single-slot keys.
 */
async function getPipeline() {
  await runLegacyCleanupOnce();
  const raw = await (0, _settingService.getSetting)(PIPELINE_KEY);
  if (!raw) return null;
  let run;
  try {
    run = JSON.parse(raw);
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'scoring-pipeline-store',
        method: 'getPipeline'
      }
    });
    _logger.default.addBreadcrumb('pipeline run row unparseable — clearing both stores', 'scoring-pipeline-store');
    await clearBoth();
    return null;
  }
  let privKeyHex;
  try {
    privKeyHex = await _secureStore.secureStore.getItemAsync(PIPELINE_PRIVKEY_KEY);
  } catch (err) {
    // Transient keychain error (e.g. locked device) — distinct from "not
    // found". Don't clear; retry once the keychain is accessible again.
    _logger.default.captureException(err, {
      tags: {
        service: 'scoring-pipeline-store',
        step: 'read-privkey'
      }
    });
    return null;
  }
  if (!privKeyHex) {
    _logger.default.addBreadcrumb('pipeline run privkey missing — clearing both stores', 'scoring-pipeline-store');
    await clearBoth();
    return null;
  }
  return {
    run,
    privKeyHex
  };
}

/**
 * Clear the run: settings row first, then the keychain secret. A secret without
 * a row is harmless (getPipeline returns null and never surfaces it), so this
 * ordering is safe.
 */
async function clearPipeline() {
  await (0, _settingService.deleteSetting)(PIPELINE_KEY);
  await _secureStore.secureStore.deleteItemAsync(PIPELINE_PRIVKEY_KEY).catch(err => {
    _logger.default.captureException(err, {
      tags: {
        service: 'scoring-pipeline-store',
        step: 'clear-privkey'
      }
    });
  });
}
const MAX_CAS_ATTEMPTS = 3;

// In-process write serialization: a module-level promise chain guarantees that
// concurrent callers in ONE JS context never interleave their read-modify-write
// (layer 1). The cross-context CAS inside `runMutation` guards against a second
// process/native context (layer 2).
let writeQueue = Promise.resolve();

/**
 * The ONLY write path after `createPipeline`. Applies `mutator` to a deep copy
 * of the current run and persists it with `version + 1`, under a two-layer
 * concurrency defense:
 *   1. In-process serialization via `writeQueue`.
 *   2. Cross-context CAS: the write only lands if the stored `version` still
 *      equals the version read at the start of the attempt (re-read
 *      immediately before writing). On mismatch it re-reads + re-applies, up to
 *      3 attempts, then throws `PipelineStaleError`.
 *
 * The mutator returning `null` aborts the write ('aborted'). Any other value
 * (including `undefined`) is a valid result and is returned alongside the
 * persisted run. Returns 'no-run' if no run exists.
 *
 * The keychain secret is never touched here — mutations only rewrite the
 * non-secret settings row.
 */
async function mutatePipeline(mutator) {
  const task = writeQueue.then(() => runMutation(mutator));
  // Keep the chain alive even if this task rejects, so a thrown
  // PipelineStaleError doesn't wedge every subsequent mutate.
  writeQueue = task.then(() => undefined, () => undefined);
  return task;
}
async function runMutation(mutator) {
  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
    const rawBefore = await (0, _settingService.getSetting)(PIPELINE_KEY);
    if (!rawBefore) return 'no-run';
    let current;
    try {
      current = JSON.parse(rawBefore);
    } catch {
      // Corrupt row — a concurrent getPipeline will self-heal it; nothing to
      // mutate here.
      return 'no-run';
    }
    const readVersion = current.version;
    // Deep copy so the mutator can't observe partial state or mutate the
    // parsed original in place; the run is pure JSON.
    const draft = JSON.parse(JSON.stringify(current));
    const result = mutator(draft);
    if (result === null) return 'aborted';

    // Re-read immediately before writing so a write by another context between
    // our initial read and now is detected (compare-and-swap).
    const rawLatest = await (0, _settingService.getSetting)(PIPELINE_KEY);
    if (!rawLatest) return 'no-run';
    let latestVersion;
    try {
      latestVersion = JSON.parse(rawLatest).version;
    } catch {
      // Someone corrupted it under us — treat as a conflict and retry.
      continue;
    }
    if (latestVersion !== readVersion) {
      // Lost the race — re-read and re-apply.
      continue;
    }
    draft.version = readVersion + 1;
    await (0, _settingService.setSetting)(PIPELINE_KEY, JSON.stringify(draft));
    return {
      result: result,
      run: draft
    };
  }
  throw new PipelineStaleError(MAX_CAS_ATTEMPTS);
}