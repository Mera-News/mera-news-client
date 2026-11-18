"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.deleteByTypes = deleteByTypes;
exports.deleteNotification = deleteNotification;
exports.deleteOlderThan = deleteOlderThan;
exports.dismiss = dismiss;
exports.getAll = getAll;
exports.getByTypes = getByTypes;
exports.markActioned = markActioned;
exports.markActionedBySource = markActionedBySource;
exports.markAllRead = markAllRead;
exports.markRead = markRead;
exports.notify = notify;
exports.observeAll = observeAll;
exports.observeUnreadCount = observeUnreadCount;
exports.prepareNotification = prepareNotification;
var _watermelondb = require("@nozbe/watermelondb");
var _rxjs = require("rxjs");
var _index = _interopRequireDefault(require("../index"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Notification-Center Service — WatermelonDB adapter for persona-v3
// `notifications`. One surface for every app-side notification (calibration,
// hygiene, migration_done, sync events, …). NOT the OS push-notification
// plumbing — that stays in lib/notification-service.ts. TTL 90d via
// `deleteOlderThan` (data-cleanup-task).

const notificationsCollection = _index.default.get('notifications');
/** Epoch-ms Date -> `YYYY-MM-DD` (UTC). */
function utcDayString(d) {
  return d.toISOString().slice(0, 10);
}

/** Epoch ms of 00:00:00.000 UTC today — lower bound for `hasNotifiedToday`'s
 *  query so it only ever scans today's rows instead of the whole (growing)
 *  notifications table. */
function startOfTodayUtcMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * True when a notification with the same `(type, source)` was already
 * created today (UTC). Used only when a caller opts in via
 * `NotifyInput.dedupeDaily`. Keyed on the full tuple, not `type` alone, so
 * distinct event types from the same source still notify independently.
 */
async function hasNotifiedToday(type, source) {
  const today = utcDayString(new Date());
  const existing = await notificationsCollection.query(_watermelondb.Q.where('type', type), _watermelondb.Q.where('source', source),
  // Bounds the scan to today's rows — without this the query (and the JS
  // filter below) would re-fetch every matching row ever created as the
  // table grows, on every deduped `notify()` call.
  _watermelondb.Q.where('created_at', _watermelondb.Q.gte(startOfTodayUtcMs()))).fetch();
  // Re-check type/source in JS too (not just via the query predicate) — a
  // cheap belt-and-braces match so this stays correct regardless of how
  // precisely the underlying query narrows rows.
  return existing.some(n => n.type === type && n.source === source && utcDayString(n.createdAt) === today);
}

/** The row, unsaved, for a caller that must commit it in its own batch. */
function prepareNotification(input) {
  return notificationsCollection.prepareCreate(n => {
    n.type = input.type;
    n.title = input.title;
    n.body = input.body;
    n.icon = input.icon ?? null;
    n.contextJson = input.context ? JSON.stringify(input.context) : null;
    n.actionsJson = input.actions ? JSON.stringify(input.actions) : null;
    n.status = 'unread';
    n.source = input.source;
    n.createdAt = new Date();
  });
}

/**
 * Creates an unread notification row. When `input.dedupeDaily` is true,
 * suppressed (returns `null`) if a notification with the same
 * `(type, source)` was already created today (UTC) — see
 * `hasNotifiedToday`. Every other caller notifies unconditionally, exactly as
 * before.
 */
async function notify(input) {
  if (input.dedupeDaily && (await hasNotifiedToday(input.type, input.source))) {
    return null;
  }
  return _index.default.write(async () => {
    const replaced = input.replaces?.length ? await notificationsCollection.query(_watermelondb.Q.where('type', _watermelondb.Q.oneOf(input.replaces))).fetch() : [];
    const row = prepareNotification(input);
    await _index.default.batch([...replaced.map(r => r.prepareDestroyPermanently()), row]);
    return row;
  });
}
async function setStatus(notificationId, status) {
  const record = await notificationsCollection.find(notificationId);
  await _index.default.write(async () => {
    await record.update(n => {
      n.status = status;
    });
  });
}
async function markRead(notificationId) {
  await setStatus(notificationId, 'read');
}
async function markActioned(notificationId) {
  await setStatus(notificationId, 'actioned');
}
async function dismiss(notificationId) {
  await setStatus(notificationId, 'dismissed');
}

/**
 * Marks every row with this exact `source` actioned (feedback requests key a
 * row per request as `feedback_request:<id>`). Rows already actioned are left
 * alone. Returns the number updated.
 */
async function markActionedBySource(source) {
  const rows = await notificationsCollection.query(_watermelondb.Q.where('source', source)).fetch();
  const pending = rows.filter(r => r.source === source && r.status !== 'actioned');
  if (pending.length === 0) return 0;
  await _index.default.write(async () => {
    await _index.default.batch(pending.map(r => r.prepareUpdate(n => {
      n.status = 'actioned';
    })));
  });
  return pending.length;
}

/** Reactive unread count — drives the bell badge. */
function observeUnreadCount() {
  return notificationsCollection.query(_watermelondb.Q.where('status', 'unread')).observeCount(false).pipe((0, _rxjs.distinctUntilChanged)());
}

/** Reactive list, newest first — drives the notification panel. */
function observeAll(limit = 100) {
  return notificationsCollection.query(_watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc), _watermelondb.Q.take(limit)).observe();
}
async function getAll(limit = 100) {
  return notificationsCollection.query(_watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc), _watermelondb.Q.take(limit)).fetch();
}

/** Marks every unread notification read. Returns the number updated. */
async function markAllRead() {
  const unread = await notificationsCollection.query(_watermelondb.Q.where('status', 'unread')).fetch();
  if (unread.length === 0) return 0;
  await _index.default.write(async () => {
    await _index.default.batch(unread.map(r => r.prepareUpdate(n => {
      n.status = 'read';
    })));
  });
  return unread.length;
}

/** Permanently deletes one notification (the inbox's delete). A row already
 *  gone is not an error. */
async function deleteNotification(notificationId) {
  const row = await notificationsCollection.find(notificationId).catch(() => null);
  if (!row) return;
  await _index.default.write(async () => {
    await row.destroyPermanently();
  });
}

/** Rows of these types, newest first (the single-row OTA notices). */
async function getByTypes(types) {
  return notificationsCollection.query(_watermelondb.Q.where('type', _watermelondb.Q.oneOf(types)), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc)).fetch();
}

/** Deletes every row of these types. Returns deleted count. */
async function deleteByTypes(types) {
  const rows = await getByTypes(types);
  if (rows.length === 0) return 0;
  await _index.default.write(async () => {
    await _index.default.batch(rows.map(r => r.prepareDestroyPermanently()));
  });
  return rows.length;
}

/** Deletes notifications created before the cutoff. Returns deleted count. */
async function deleteOlderThan(cutoffMs) {
  const old = await notificationsCollection.query(_watermelondb.Q.where('created_at', _watermelondb.Q.lt(cutoffMs))).fetch();
  if (old.length === 0) return 0;
  await _index.default.write(async () => {
    await _index.default.batch(old.map(r => r.prepareDestroyPermanently()));
  });
  return old.length;
}