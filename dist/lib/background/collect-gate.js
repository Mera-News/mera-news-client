"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isBackgroundCollectRunning = isBackgroundCollectRunning;
exports.trackBackgroundCollect = trackBackgroundCollect;
exports.waitForBackgroundCollect = waitForBackgroundCollect;
// "Is a background collect running right now?", for the foreground.
//
// The user can open the app while the OS task is inside step (a), GETting and
// applying the device's waiting batches. The foreground `inference-recover`
// would then poll the same batches. The pipeline's per-batch claim keeps the
// two from applying one batch twice; this gate additionally lets recover wait,
// briefly, for the background collect to finish, so the foreground starts from
// the state the collect wrote rather than racing it.
//
// Dependency-free on purpose: the recover task imports it on every boot.

let active = null;

/** Mark a collect as running until `work` settles. Never rejects. */
function trackBackgroundCollect(work) {
  const settled = work.then(() => undefined, () => undefined);
  active = settled;
  void settled.then(() => {
    if (active === settled) active = null;
  });
  return work;
}

/** Resolve once no background collect is running, or after `maxWaitMs`. */
async function waitForBackgroundCollect(maxWaitMs) {
  const running = active;
  if (!running) return;
  let timer;
  await Promise.race([running, new Promise(resolve => {
    timer = setTimeout(resolve, maxWaitMs);
  })]);
  clearTimeout(timer);
}
function isBackgroundCollectRunning() {
  return active !== null;
}