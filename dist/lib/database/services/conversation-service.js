"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.appendMessage = appendMessage;
exports.createConversation = createConversation;
exports.deleteMessage = deleteMessage;
exports.fetchMessagesBefore = fetchMessagesBefore;
exports.fetchMessagesForConversation = fetchMessagesForConversation;
exports.patchMessageToolCallResult = patchMessageToolCallResult;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Conversation Service — durable chat-history persistence.
//
// Backs the long-lived, user-owned `conversations` / `messages` tables. Unlike
// the ephemeral suggestion caches these are never wiped on resync. Messages can
// be paged reverse-chronologically ACROSS all conversations to power a unified
// chat history / fact-card timeline.

const conversationsCol = _index.default.get('conversations');
const messagesCol = _index.default.get('messages');
/** In `suggested_options_json`, which nothing else reads or writes: a dedicated
 *  column is a schema bump, and a rollback past a bump wipes the database. */
const FAILED_MARK = '{"failed":true}';
// --- Helpers ---

/** Parses a tool_calls_json string, tolerating corrupt values by returning null. */
function parseToolCalls(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        source: 'conversation-service',
        method: 'parseToolCalls'
      }
    });
    return null;
  }
}
function toPersistedMessage(record) {
  return {
    id: record.id,
    conversationId: record.conversationId,
    role: record.role,
    content: record.content,
    toolCalls: parseToolCalls(record.toolCallsJson),
    failed: record.suggestedOptionsJson === FAILED_MARK,
    createdAt: record.createdAt.getTime()
  };
}

/**
 * Deterministic reverse-chronological comparator: created_at desc, id desc
 * tie-break. Used to order rows within JS so identical timestamps stay stable.
 */
function byNewestFirst(a, b) {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** True when `m` sorts strictly older than the cursor in (created_at, id) desc order. */
function isOlderThanCursor(m, cursor) {
  if (m.createdAt !== cursor.createdAt) return m.createdAt < cursor.createdAt;
  return m.id < cursor.id;
}

// --- Write ---

async function createConversation(surface) {
  let createdId = '';
  await _index.default.write(async () => {
    const record = await conversationsCol.create(c => {
      c.surface = surface;
    });
    createdId = record.id;
  });
  return createdId;
}

/**
 * Appends a message. When `explicitId` is provided the row is created with that
 * id (the in-memory message id) rather than an auto-generated one — this makes
 * the DB id and in-memory id one and the same, so resumed messages dedupe
 * cleanly against the live/cloud-store session and persistence stays idempotent
 * across popover reopen (the persistence hook seeds its ref from these ids).
 */
async function appendMessage(conversationId, msg, explicitId) {
  // ALREADY THERE IS NOT AN ERROR. The caller's in-memory "already persisted"
  // guard is a ref, so it is empty again after any remount (Fast Refresh in
  // dev, closing and reopening the chat sheet in production) while the row it
  // was guarding is still in SQLite. The insert then fails the primary key and
  // the turn logs `sqlite error 1555 (UNIQUE constraint failed: messages.id)`.
  //
  // Nothing is lost when that happens, precisely because the row exists, so the
  // honest outcome is the id rather than a throw. Checked rather than caught:
  // swallowing the constraint error would also swallow a genuine write failure
  // that happened to look like one.
  // `find` rather than a query: a missing row is the documented throw in
  // WatermelonDB, and the collection's own cache answers it without a round
  // trip when the row is already loaded.
  if (explicitId) {
    try {
      const existing = await messagesCol.find(explicitId);
      return existing.id;
    } catch {
      // Not there. Fall through and create it.
    }
  }
  let createdId = '';
  await _index.default.write(async () => {
    const record = await messagesCol.create(m => {
      if (explicitId) {
        // Sanctioned WMDB way to set a custom primary key on create.
        m._raw.id = explicitId;
      }
      m.conversationId = conversationId;
      m.role = msg.role;
      m.content = msg.content;
      m.toolCallsJson = msg.toolCalls && msg.toolCalls.length > 0 ? JSON.stringify(msg.toolCalls) : null;
      m.suggestedOptionsJson = msg.failed ? FAILED_MARK : null;
    });
    createdId = record.id;
  });
  return createdId;
}

/**
 * Rewrites ONE tool call's result on a persisted message.
 *
 * Exists because a fact-choice card commits from the UI long after the model's
 * tool call returned `staged: true`, and every downstream card reads
 * `savedFacts` off the PERSISTED result. Rewriting the row is what makes the
 * commit survive a relaunch; the in-memory override in floating-chat-store is
 * only what makes it instant.
 *
 * A missing row is not an error: an assistant message persists only once the
 * turn finalises, so a very fast tap can land first. `useChatPersistence` merges
 * the override in at write time for exactly that case, and this call no-ops.
 */
/** Removes one message. A missing row is not an error. */
async function deleteMessage(id) {
  await _index.default.write(async () => {
    const row = await messagesCol.find(id).catch(() => null);
    await row?.destroyPermanently();
  });
}
async function patchMessageToolCallResult(messageId, toolCallIndex, result) {
  try {
    const record = await messagesCol.find(messageId);
    const parsed = parseToolCalls(record.toolCallsJson);
    if (!parsed || !parsed[toolCallIndex]) return false;
    // READ-PATCH-WRITE the whole array: only the one call's result changes, and
    // every sibling call on the same message is preserved byte for byte.
    const next = parsed.map((tc, i) => i === toolCallIndex ? {
      ...tc,
      result,
      status: 'done'
    } : tc);
    await _index.default.write(async () => {
      await record.update(m => {
        m.toolCallsJson = JSON.stringify(next);
      });
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads all messages for one conversation, oldest-first. Powers resuming the
 * CURRENT app-session conversation when the popover reopens (its live state may
 * have been torn down on collapse).
 */
async function fetchMessagesForConversation(conversationId) {
  const records = await messagesCol.query(_watermelondb.Q.where('conversation_id', conversationId), _watermelondb.Q.sortBy('created_at', _watermelondb.Q.asc)).fetch();
  const items = records.map(toPersistedMessage);
  // Finalize ordering in JS (oldest-first) so it's exact regardless of adapter
  // sort stability — mirror byNewestFirst's tie-break, reversed.
  items.sort((a, b) => -byNewestFirst(a, b));
  return items;
}

// --- Read (reverse-chronological pagination across all conversations) ---

/**
 * Pages messages newest-first ACROSS all conversations. `cursor` returns only
 * messages strictly older than {createdAt, id} (id tie-break for identical
 * timestamps); pass null for the first page. `excludeConversationId` drops the
 * currently-open conversation from the history feed.
 *
 * Ordering (created_at desc, id desc tie-break) is finalized in JS so the
 * tie-break is exact regardless of the underlying adapter's sort stability.
 */
async function fetchMessagesBefore(cursor, limit, excludeConversationId) {
  if (limit <= 0) {
    return {
      items: [],
      nextCursor: null,
      hasMore: false
    };
  }

  // Coarse DB-side narrowing where possible (a superset; JS refines below). The
  // cursor bound is `<=` so equal-timestamp rows are retained for the exact
  // id tie-break. Exact filtering + ordering happens in JS so it stays correct
  // even against adapters that ignore predicates.
  const clauses = [];
  if (excludeConversationId) {
    clauses.push(_watermelondb.Q.where('conversation_id', _watermelondb.Q.notEq(excludeConversationId)));
  }
  if (cursor) {
    clauses.push(_watermelondb.Q.where('created_at', _watermelondb.Q.lte(cursor.createdAt)));
  }
  clauses.push(_watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc));
  const records = await messagesCol.query(...clauses).fetch();
  let items = records.map(toPersistedMessage);
  if (excludeConversationId) {
    items = items.filter(m => m.conversationId !== excludeConversationId);
  }
  if (cursor) {
    items = items.filter(m => isOlderThanCursor(m, cursor));
  }
  items.sort(byNewestFirst);
  const hasMore = items.length > limit;
  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? {
    createdAt: last.createdAt,
    id: last.id
  } : null;
  return {
    items: page,
    nextCursor,
    hasMore
  };
}