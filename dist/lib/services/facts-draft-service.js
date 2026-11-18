"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FACTS_DRAFT_OPEN_KEY = exports.FACTS_DRAFT_FINGERPRINT_KEY = void 0;
exports.closeFactsDraft = closeFactsDraft;
exports.factsFingerprint = factsFingerprint;
exports.openFactsDraft = openFactsDraft;
exports.recoverOpenFactsDraft = recoverOpenFactsDraft;
exports.settleProfileChatClose = settleProfileChatClose;
var _factService = require("../database/services/fact-service");
var _settingService = require("../database/services/setting-service");
var _comboPassService = require("../database/services/combo-pass-service");
// facts-draft-service — did a Profile-opened chat change the persona?
//
// Friction this removes: the combination pass (topics that exist because two
// facts sit side by side) is costly and must run once per EDITING SESSION, not
// once per fact. A Profile chat is that session. On open, the (fact id,
// statement) pairs are fingerprinted into settings; on close they are compared,
// and any add, update or delete marks the pass pending. A kill while the chat
// is open leaves the open marker behind, and the next launch settles it the
// same way (`recoverOpenFactsDraft`, called by inference-recover).
//
// Settings are backed up by allowlist, so these keys never travel: a restore
// re-runs nothing.

const FACTS_DRAFT_OPEN_KEY = exports.FACTS_DRAFT_OPEN_KEY = 'facts_draft_open';
const FACTS_DRAFT_FINGERPRINT_KEY = exports.FACTS_DRAFT_FINGERPRINT_KEY = 'facts_draft_fingerprint';

/** FNV-1a over the sorted pairs. Order-independent; any statement change
 *  changes it. Not a security hash: it only has to notice an edit. */
function factsFingerprint(facts) {
  const joined = facts.map(f => `${f.id}\u0001${f.statement}`).sort().join('\u0002');
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${facts.length}:${h.toString(16)}`;
}
async function currentFingerprint() {
  const facts = await (0, _factService.getFacts)();
  return factsFingerprint(facts.map(f => ({
    id: f.id,
    statement: f.statement
  })));
}

/** Open and close can land back to back (a quick dismiss); serialising them
 *  keeps a close from reading the marker before the open wrote it. */
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/** A Profile-opened chat just expanded: remember the facts as they are. */
function openFactsDraft() {
  return serial(async () => {
    await (0, _settingService.setSetting)(FACTS_DRAFT_FINGERPRINT_KEY, await currentFingerprint());
    await (0, _settingService.setSetting)(FACTS_DRAFT_OPEN_KEY, '1');
  });
}

/**
 * Compare and clear. The pass is marked pending BEFORE the markers are
 * cleared: a kill between the two leaves the open marker, and the next launch
 * re-detects the change rather than losing it.
 */
async function settle() {
  if ((await (0, _settingService.getSetting)(FACTS_DRAFT_OPEN_KEY)) !== '1') return false;
  const before = await (0, _settingService.getSetting)(FACTS_DRAFT_FINGERPRINT_KEY);
  const changed = before !== (await currentFingerprint());
  if (changed) await (0, _comboPassService.markComboPending)();
  await (0, _settingService.deleteSetting)(FACTS_DRAFT_OPEN_KEY);
  await (0, _settingService.deleteSetting)(FACTS_DRAFT_FINGERPRINT_KEY);
  return changed;
}

/** The chat closed. True when the persona changed while it was open. */
function closeFactsDraft() {
  return serial(settle);
}

/** Launch-time twin of `closeFactsDraft` for a draft a kill left open.
 *  Idempotent: the first call clears the marker. */
function recoverOpenFactsDraft() {
  return serial(settle);
}

/** The close path: settle the draft, and when it changed facts start the pass
 *  (cloud) or the refresh (on-device) right away. */
async function settleProfileChatClose() {
  if (await closeFactsDraft()) await (0, _comboPassService.runPendingComboPass)();
}