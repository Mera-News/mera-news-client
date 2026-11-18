"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.STALE_MACHINE_AGE_MS = exports.NETWORK_DEPENDENT_STATES = exports.InvalidTransitionError = exports.FEED_SYNC_MACHINE_KEY = void 0;
class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`Invalid FeedSyncMachine transition: ${from} → ${to}`);
  }
}
exports.InvalidTransitionError = InvalidTransitionError;
const NETWORK_DEPENDENT_STATES = exports.NETWORK_DEPENDENT_STATES = ['fetching-topic-ids', 'hydrating'];

/** Persisted snapshot of the machine in WatermelonDB `settings`. */

const FEED_SYNC_MACHINE_KEY = exports.FEED_SYNC_MACHINE_KEY = 'feed_sync_machine_state';
const STALE_MACHINE_AGE_MS = exports.STALE_MACHINE_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * What a BACKGROUND run (the `mera-background` OS task, no UI, 60s budget)
 * does differently, injected by `lib/background/background-feed-sync.ts`.
 *
 * Passing this puts the machine in background mode: no keep-awake, no toasts,
 * no status publishes, no offline pause (a lost
 * link fails the run instead of parking it), no foreground drain, and the
 * scoring step is the bounded background submit instead of `stepScore`.
 */