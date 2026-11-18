"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clearMachineSnapshot = clearMachineSnapshot;
exports.loadMachineSnapshot = loadMachineSnapshot;
exports.loadValidSnapshot = loadValidSnapshot;
exports.saveMachineSnapshot = saveMachineSnapshot;
exports.updateMachineState = updateMachineState;
var _settingService = require("../../database/services/setting-service");
var _feedSyncTypes = require("./feed-sync-types");
async function loadMachineSnapshot() {
  const raw = await (0, _settingService.getSetting)(_feedSyncTypes.FEED_SYNC_MACHINE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function saveMachineSnapshot(snapshot) {
  await (0, _settingService.setSetting)(_feedSyncTypes.FEED_SYNC_MACHINE_KEY, JSON.stringify(snapshot));
}
async function clearMachineSnapshot() {
  await (0, _settingService.deleteSetting)(_feedSyncTypes.FEED_SYNC_MACHINE_KEY);
}

/** Returns the persisted state if still valid (<2h old), null if stale or absent. */
async function loadValidSnapshot() {
  const snap = await loadMachineSnapshot();
  if (!snap) return null;
  if (Date.now() - snap.startedAt > _feedSyncTypes.STALE_MACHINE_AGE_MS) {
    await clearMachineSnapshot();
    return null;
  }
  return snap;
}
async function updateMachineState(state) {
  const existing = await loadMachineSnapshot();
  if (!existing) return;
  await saveMachineSnapshot({
    ...existing,
    state
  });
}