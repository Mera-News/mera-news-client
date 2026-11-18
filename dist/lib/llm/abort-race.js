"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.linkedAbort = linkedAbort;
exports.raceSignal = raceSignal;
var _retry = require("../utils/retry");
// Deadline plumbing for the OS background task.
//
// The friction: the background run has ONE hard deadline, but several awaits on
// its path take no AbortSignal (`getJwtToken`, the rate limiter's `acquire`).
// Racing them against the signal is what lets the run stop on time; the losing
// promise keeps running and settles harmlessly.

/** Resolve with `p`, or reject with the app's cancellation error the moment
 *  `signal` aborts. Without a signal this is `p`. */
function raceSignal(p, signal) {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject((0, _retry.createCancellationError)());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject((0, _retry.createCancellationError)());
    signal.addEventListener('abort', onAbort, {
      once: true
    });
    p.then(v => {
      signal.removeEventListener('abort', onAbort);
      resolve(v);
    }, err => {
      signal.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

/**
 * An AbortController that fires when `outer` aborts OR after `timeoutMs`,
 * whichever comes first. Call `dispose()` in a finally so the timer and the
 * listener never outlive the request.
 */
function linkedAbort(outer, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuter = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();else outer.addEventListener('abort', onOuter, {
      once: true
    });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    }
  };
}