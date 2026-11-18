"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NOTIFY_TITLE_MAX = exports.ASKED_TTL_MS = void 0;
exports.forgetFactCheckAsked = forgetFactCheckAsked;
exports.listAskedFactChecks = listAskedFactChecks;
exports.noteFactCheckStored = noteFactCheckStored;
exports.onFactCheckAsked = onFactCheckAsked;
exports.outcomeFor = outcomeFor;
exports.recordFactCheckAsked = recordFactCheckAsked;
var _logger = _interopRequireDefault(require("../logger"));
var _factCheckState = require("./fact-check-state");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// fact-check-settled — "your fact check is ready", for checks THIS device asked for.
//
// The server check finishes asynchronously, usually within 30s, and nothing
// pushes the result: the old server push was removed because sending it needed
// a user-to-article link (see resolveNotificationRoute in lib/notification-service).
// So the device notices the result itself, in places that can each see the
// same row change: the ask, the article panel's poll, and the re-read below.
// All store through `storeServerFactCheck`, which is the ONE place a settled
// check is detected.
//
// SCOPE: only checks this device asked for. The asked list is also the gate on
// every fetch after the ask (the panel poll, the re-read): a row this device
// did not ask for (one stored before the community lookup was removed) is
// shown as it is and never fetched or announced. The asked list is persisted, so it
// survives the JS reload every return to the foreground causes, and the
// re-read rebuilds its work from it after each reload.
//
// In-app only for now: a notification-centre row plus the toast. The OS
// notification is on hold for its own design.

/** The persisted list of asks, by article id. */
const ASKED_KEY = 'mera_fact_check_asked_v1';
/** An ask older than this is dropped unanswered: the foreground re-read has
 *  had every chance, and the Dashboard list still shows the row. */
const ASKED_TTL_MS = exports.ASKED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Titles in the notification body are cut here, so a long headline cannot
 *  push the outcome off the row. */
const NOTIFY_TITLE_MAX = exports.NOTIFY_TITLE_MAX = 60;
// Lazy: `setting-service` builds a WatermelonDB collection at module scope, so
// a top-level import would construct a real SQLiteAdapter in every suite that
// loads the fact-check client.
function settings() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../database/services/setting-service");
}
async function readAsked() {
  try {
    const raw = await settings().getSetting(ASKED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
async function writeAsked(map) {
  try {
    await settings().setSetting(ASKED_KEY, JSON.stringify(map));
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'fact-check-settled',
        method: 'writeAsked'
      }
    });
  }
}

// Serialises read-modify-write of the asked map: two stores landing in the
// same tick must not each write back a map missing the other's change.
let queue = Promise.resolve();
function serial(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

// Told when an ask is recorded, so an open article panel starts polling a row
// it had been showing as stalled (a tap on an older unasked row). Memory only.
const askListeners = new Set();
function onFactCheckAsked(listener) {
  askListeners.add(listener);
  return () => {
    askListeners.delete(listener);
  };
}

/** Records an explicit ask. Reached only through `requestFactCheck`. Listeners hear a first ask
 *  or a reader's own tap, never the panel poll's re-ask: that woke the panel into polling again at
 *  once, a request per render while the server returned no row. */
function recordFactCheckAsked(entry, now = Date.now(), explicit = false) {
  return serial(async () => {
    const map = await readAsked();
    const wake = explicit || !map[entry.articleId];
    map[entry.articleId] = {
      ...entry,
      askedAt: now
    };
    await writeAsked(map);
    if (wake) for (const listener of askListeners) listener(entry.articleId);
  });
}

/** The asks still worth re-reading, oldest first. Expired ones are dropped. */
function listAskedFactChecks(now = Date.now()) {
  return serial(async () => {
    const map = await readAsked();
    let changed = false;
    for (const [id, a] of Object.entries(map)) {
      if (!a || typeof a.askedAt !== 'number' || now - a.askedAt > ASKED_TTL_MS) {
        delete map[id];
        changed = true;
      }
    }
    if (changed) await writeAsked(map);
    return Object.values(map).sort((a, b) => a.askedAt - b.askedAt);
  });
}
function takeAsked(articleId) {
  return serial(async () => {
    const map = await readAsked();
    const hit = map[articleId] ?? null;
    if (hit) {
      delete map[articleId];
      await writeAsked(map);
    }
    return hit;
  });
}

/** Drops an ask whose article the server no longer holds: nothing can ever settle it. */
async function forgetFactCheckAsked(articleId) {
  await takeAsked(articleId);
}

/** Which of the three notification bodies a settled check gets. */
function outcomeFor(row) {
  const external = (0, _factCheckState.describeExternalChecks)(row.status, (0, _factCheckState.describeCheckedBy)(row.checkedBy).length, row.checkedByStatus);
  if (external === 'published') return 'found';
  if (external === 'none-published') return 'none';
  return 'unavailable';
}
const BODY_KEY = {
  found: 'factCheck.notify.bodyFound',
  none: 'factCheck.notify.bodyNone',
  unavailable: 'factCheck.notify.bodyUnavailable'
};
/** The same bodies written without {{title}}, for a check with no title at
 *  all: interpolating an empty one read 'for ""'. */
const BODY_KEY_UNTITLED = {
  found: 'factCheck.notify.bodyFoundUntitled',
  none: 'factCheck.notify.bodyNoneUntitled',
  unavailable: 'factCheck.notify.bodyUnavailableUntitled'
};
function clip(title) {
  const t = title.trim();
  return t.length > NOTIFY_TITLE_MAX ? `${t.slice(0, NOTIFY_TITLE_MAX - 1).trimEnd()}…` : t;
}

/**
 * Called after every store of a server check, with the status the local row
 * had BEFORE the store. Notifies once, when an ASKED check goes from waiting
 * to settled. An ask whose very first answer is already settled was answered
 * on the spot, in front of the reader, so it is cleared without a notification.
 */
async function noteFactCheckStored(articleId, previousStatus, row) {
  if (!(0, _factCheckState.isTerminalStatus)(row.status)) return false;
  const asked = await takeAsked(articleId);
  if (!asked) return false;
  if (previousStatus === null || (0, _factCheckState.isTerminalStatus)(previousStatus)) return false;
  const outcome = outcomeFor(row);
  const articleTitle = row.articleTitle ?? asked.title ?? '';
  const shownTitle = clip(articleTitle);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      toastManager
    } = require("../platform/toast");
    await toastManager.showNotifiedToast({
      type: 'fact_check_done',
      source: 'fact-check',
      title: 'factCheck.notify.title',
      body: shownTitle ? BODY_KEY[outcome] : BODY_KEY_UNTITLED[outcome],
      icon: 'fact-check',
      context: {
        articleId,
        ...(asked.suggestionId ? {
          suggestionId: asked.suggestionId
        } : {}),
        articleTitle,
        outcome,
        // The body's interpolation value, pre-cut.
        title: shownTitle
      },
      actions: [{
        id: 'open-fact-check',
        labelKey: 'factCheck.notify.open'
      }]
    });
    return true;
  } catch (err) {
    _logger.default.captureException(err, {
      tags: {
        service: 'fact-check-settled',
        method: 'noteFactCheckStored'
      },
      extra: {
        articleId
      }
    });
    return false;
  }
}