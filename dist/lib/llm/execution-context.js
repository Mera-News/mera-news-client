"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.contextForCycleReason = contextForCycleReason;
exports.usesJwt = usesJwt;
// ExecutionContext — explicit marker passed PER CALL through every
// inference-gateway call. Never stored in module state: a background run and a
// foreground poll can interleave in one JS runtime, so a global would hand one
// caller the other's auth rules. The auth-selection rule is strict:
//   - foreground → user JWT first (read from keychain), the per-batch
//     capability token as a fallback while it is still inside its 2h TTL.
//   - background → capability token only. Used by the silent-push wake, which
//     may run before the keychain is readable and must never mint.
//   - task       → user JWT only (cookie → JWT mint), for the OS background
//     task (expo-background-task). No capability-token fallback, no 401
//     re-mint, no auth-breaker report: a dead or unreadable session exits the
//     run quietly and the next foreground deals with it. The keychain is
//     AFTER_FIRST_UNLOCK, so a task run after the first unlock can read it.
// A call with no usable credential for its context throws or reports
// `no-auth` — the batch stays put and the next tick retries.

/** True for the contexts that authenticate with the user's JWT. */
function usesJwt(context) {
  return context === 'foreground' || context === 'task';
}

/** Map a runBackgroundCycle reason to the execution context that produced
 *  it. Background reasons are the silent-push wakes delivered to the
 *  TaskManager task; everything else originates from a foreground caller
 *  (AppLayout poll, syncFeed, pull-to-refresh, scoring-pass). */
function contextForCycleReason(reason) {
  switch (reason) {
    case 'phase1-done':
    case 'phase2-done':
    case 'silent-push':
      return 'background';
    case 'app-resume':
    case 'scoring-pass':
      return 'foreground';
  }
}