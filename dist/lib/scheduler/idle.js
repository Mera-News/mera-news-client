"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.runWhenIdle = runWhenIdle;
exports.yieldToEventLoop = yieldToEventLoop;
exports.yieldToInteractions = yieldToInteractions;
exports.yieldToInteractionsWithTimeout = yieldToInteractionsWithTimeout;
var _sleep = require("../utils/sleep");
// Cooperative yielding helpers so heavy background work (feed-sync store
// refreshes, on-device scoring batches) doesn't starve hydration/first-paint or
// jank foreground animations. RN-touching code is fine in lib/scheduler/.

/** Run `cb` on the next macrotask; the returned function cancels it. RN's interaction manager was already a setImmediate stub in RN 0.83, so this keeps today's timing. */
function runWhenIdle(cb) {
  const id = setTimeout(cb, 0);
  return () => clearTimeout(id);
}

/**
 * Resolve on the next macrotask. Use to defer non-urgent work past
 * gestures/first-paint so the UI thread stays responsive.
 */
function yieldToInteractions() {
  return new Promise(resolve => {
    runWhenIdle(resolve);
  });
}

/**
 * `yieldToInteractions` with a hard ceiling: whichever of the yield and the
 * timeout resolves first wins.
 */
function yieldToInteractionsWithTimeout(ms) {
  return Promise.race([yieldToInteractions(), (0, _sleep.sleep)(ms)]);
}

/**
 * Resolve on the next macrotask (setTimeout 0). Lets the JS thread drain pending
 * work (renders, touch handling) between tight loop iterations 
 */
function yieldToEventLoop() {
  return new Promise(resolve => setTimeout(resolve, 0));
}