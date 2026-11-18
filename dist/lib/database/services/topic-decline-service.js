"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.UNDO_WINDOW_MS = exports.UNDO_WINDOW_MIN_MS = exports.UNDO_WINDOW_MAX_MS = void 0;
exports.__resetPendingForTests = __resetPendingForTests;
exports.cancelPendingDeletes = cancelPendingDeletes;
exports.deleteTopicWithDecline = void 0;
exports.flushPendingDeletes = flushPendingDeletes;
exports.getAllDeclinedNormalizedTexts = getAllDeclinedNormalizedTexts;
exports.getDeclinedTopicTexts = getDeclinedTopicTexts;
exports.listDeclinedTopics = listDeclinedTopics;
exports.undoPendingDelete = exports.removeDecline = exports.recordDecline = void 0;
var _watermelondb = require("@nozbe/watermelondb");
var _index = _interopRequireDefault(require("../index"));
var _logger = _interopRequireDefault(require("../../logger"));
var _topicService = require("./topic-service");
var _command = require("../../sync/command");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Topic deletion with a short undo, and the declines it leaves behind.
//
// The delete is STAGED, not committed: `deleteTopicWithDecline` sets
// `topics.pending_delete_at` and writes the decline row, and the destroy
// happens later in `flushPendingDeletes`. Staging lives on a COLUMN rather
// than in a module Map because the flush has to run on app start — an
// in-memory registry has nothing to flush there, so a process death inside the
// undo window would silently resurrect a topic the user watched disappear.
//
// The timer below is a convenience, never the guarantee. Correctness comes
// from the column plus three flush entry points: this timer, app start, and
// every app foreground (both scheduled from the `inference-recover` task). If
// the timer never fires, the row is still staged on disk and the next launch
// commits it.

const topicsCollection = _index.default.get('topics');
const declinedCollection = _index.default.get('declined_topics');

/** Default undo window. */
const UNDO_WINDOW_MS = exports.UNDO_WINDOW_MS = 5_000;
/** Accessibility affordance bounds. A value outside these is clamped and
 *  logged, never thrown — this runs in front of the user. The upper bound is
 *  not defensive noise: a staged row is invisible to every render but still
 *  counted by `getAllTopicIds()`, so an absurd window would pin it there. */
const UNDO_WINDOW_MIN_MS = exports.UNDO_WINDOW_MIN_MS = 1_000;
const UNDO_WINDOW_MAX_MS = exports.UNDO_WINDOW_MAX_MS = 60_000;

/** Default page size for the agent's prompt context. */
const DECLINED_TEXTS_LIMIT = 50;

/** Per-stage bookkeeping that only matters while this process is alive.
 *  In-memory is correct: if the process dies the undo is unreachable anyway
 *  and the decline is already committed, which is the right outcome. */

const pending = new Map();

/** Serialises flushes so the timer and a foreground firing together cannot
 *  double-commit. */
let inFlightFlush = null;
function clampWindow(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return UNDO_WINDOW_MS;
  const clamped = Math.min(UNDO_WINDOW_MAX_MS, Math.max(UNDO_WINDOW_MIN_MS, ms));
  if (clamped !== ms) {
    _logger.default.warn('[topic-decline] undo window clamped', {
      requested: ms,
      applied: clamped
    });
  }
  return clamped;
}

/**
 * Record that the user declined a topic text, whether or not a row ever
 * existed for it.
 *
 * Exposed separately because the agent declines proposals that were never
 * minted. Upserts on `normalized_text`: a re-decline refreshes `created_at`
 * instead of adding a second row.
 *
 * Takes the DISPLAY text and normalises internally — the table stores both,
 * and a caller passing a pre-normalised string would put lowercased,
 * whitespace-collapsed text on the user's "Topics you removed" list.
 *
 * Returns the row id and the previous `created_at` (null when newly created),
 * which is what lets an undo put an older decline back exactly as it was.
 */
async function recordDeclineLocal(text, factId) {
  const display = text.trim();
  const normalized = (0, _topicService.normalizeTopicText)(display);
  if (!normalized) throw new Error('recordDecline: empty text');
  const existing = await declinedCollection.query(_watermelondb.Q.where('normalized_text', normalized)).fetch();
  const now = new Date();
  if (existing.length > 0) {
    const row = existing[0];
    const previous = row.createdAt?.getTime() ?? null;
    await _index.default.write(async () => {
      await _index.default.batch([row.prepareUpdate(r => {
        r.createdAt = now;
        if (factId) r.sourceFactId = factId;
      })]);
    });
    return {
      id: row.id,
      previousCreatedAtMs: previous
    };
  }
  const created = await _index.default.write(async () => declinedCollection.create(r => {
    r.text = display;
    r.normalizedText = normalized;
    r.sourceFactId = factId;
    r.createdAt = now;
  }));
  return {
    id: created.id,
    previousCreatedAtMs: null
  };
}
const recordDecline = exports.recordDecline = (0, _command.command)('recordDecline', recordDeclineLocal);

/**
 * Stage a topic for deletion and remember the decline.
 *
 * ONE write does both: the row is marked `pending_delete_at` and the decline
 * is recorded. The decline is written HERE, at stage time rather than at
 * commit, to close the re-mint race — without it, deleting a chip and tapping
 * "More topics" inside the undo window regenerates the same topic, because the
 * staged row is invisible to `createTopics`' dedup and a fresh row is minted.
 * With the decline already on disk, generation filters the text out before it
 * ever reaches `createTopics`.
 *
 * The row disappears from `observeByFact` and every other render/retrieve read
 * immediately; the caller holds the chip in its own state for the undo.
 */
async function deleteTopicWithDeclineLocal(topicId, opts) {
  const topic = await topicsCollection.find(topicId);

  // Recorded before the stage write so an undo can restore an older decline
  // exactly, rather than destroying one the user made weeks ago.
  const decline = await recordDecline(topic.text, topic.factId ?? null);
  await _index.default.write(async () => {
    await _index.default.batch([topic.prepareUpdate(t => {
      t.pendingDeleteAt = Date.now();
      t.updatedAt = new Date();
    })]);
  });
  const existing = pending.get(topicId);
  if (existing?.timer) clearTimeout(existing.timer);
  const entry = {
    topicId,
    declinedRowId: decline.id,
    previousCreatedAtMs: existing?.previousCreatedAtMs ?? decline.previousCreatedAtMs,
    timer: null
  };
  entry.timer = setTimeout(() => {
    void flushPendingDeletes().catch(() => {});
  }, clampWindow(opts?.undoWindowMs));
  pending.set(topicId, entry);
  return {
    undoToken: topicId
  };
}
const deleteTopicWithDecline = exports.deleteTopicWithDecline = (0, _command.command)('deleteTopicWithDecline', deleteTopicWithDeclineLocal);

/**
 * Cancel a staged delete: clear the marker and undo the decline.
 *
 * Returns false for an unknown token or one whose delete already committed.
 * Never throws — it is wired to a toast button.
 */
async function undoPendingDeleteLocal(topicId) {
  try {
    const entry = pending.get(topicId);
    if (entry?.timer) clearTimeout(entry.timer);
    pending.delete(topicId);
    let topic;
    try {
      topic = await topicsCollection.find(topicId);
    } catch {
      return false; // already destroyed by a flush
    }
    if (topic.pendingDeleteAt == null) return false;
    const declineRow = entry ? await declinedCollection.find(entry.declinedRowId).catch(() => null) : null;
    await _index.default.write(async () => {
      const ops = [topic.prepareUpdate(t => {
        t.pendingDeleteAt = null;
        t.updatedAt = new Date();
      })];
      if (declineRow) {
        ops.push(entry.previousCreatedAtMs == null ? declineRow.prepareDestroyPermanently() : declineRow.prepareUpdate(r => {
          r.createdAt = new Date(entry.previousCreatedAtMs);
        }));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await _index.default.batch(ops);
    });
    return true;
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'topic-decline',
        method: 'undoPendingDelete'
      },
      extra: {
        topicId
      }
    });
    return false;
  }
}
const undoPendingDelete = exports.undoPendingDelete = (0, _command.command)('undoPendingDelete', undoPendingDeleteLocal);

/**
 * Commit every staged delete. Runs from this module's timer, from app start
 * and from every app foreground — never from a component, so a delete cannot
 * outlive the card that started it.
 *
 * Returns the number of rows committed.
 */
async function flushPendingDeletes() {
  if (inFlightFlush) return inFlightFlush;
  inFlightFlush = doFlush().finally(() => {
    inFlightFlush = null;
  });
  return inFlightFlush;
}
async function doFlush() {
  try {
    const staged = await topicsCollection.query(_watermelondb.Q.where('pending_delete_at', _watermelondb.Q.notEq(null))).fetch();
    if (staged.length === 0) return 0;
    for (const t of staged) {
      const e = pending.get(t.id);
      if (e?.timer) clearTimeout(e.timer);
      pending.delete(t.id);
    }

    // TRACKED-STORY GUARD, applied at commit rather than at stage.
    // `tracked_stories.topic_id` is a real reference: destroying the topic
    // leaves it dangling and that followed story silently stops matching new
    // articles forever, with no error anywhere. Those rows are RETIRED
    // instead. The chip already vanished at stage time, so the user sees no
    // difference, and the decline stands either way.
    const trackedRows = await _index.default.get('tracked_stories').query(_watermelondb.Q.where('topic_id', _watermelondb.Q.oneOf(staged.map(t => t.id)))).fetch();
    const guarded = new Set(trackedRows.map(r => r.topicId ?? '').filter(Boolean));
    const doomed = staged.filter(t => !guarded.has(t.id));

    // Prune the committed texts from `fact.metadata.topics`, the SECOND topic
    // list the facts screen renders. Without this a deleted chip lives on
    // there forever.
    const prunePerFact = new Map();
    for (const t of doomed) {
      const factId = t.factId ?? null;
      if (!factId) continue;
      const set = prunePerFact.get(factId) ?? new Set();
      set.add(t.normalizedText);
      prunePerFact.set(factId, set);
    }
    const factRows = prunePerFact.size > 0 ? await _index.default.get('facts').query(_watermelondb.Q.where('id', _watermelondb.Q.oneOf([...prunePerFact.keys()]))).fetch() : [];
    await _index.default.write(async () => {
      const now = new Date();
      const factUpdates = factRows.map(fact => {
        const current = fact.metadata ?? {};
        const existingTexts = Array.isArray(current.topics) ? current.topics : [];
        const drop = prunePerFact.get(fact.id) ?? new Set();
        const kept = existingTexts.filter(t => !drop.has((0, _topicService.normalizeTopicText)(t)));
        if (kept.length === existingTexts.length) return null;
        return fact.prepareUpdate(f => {
          // Spread `current`: assigning `{ topics }` alone would drop
          // topicGenError and topicsReviewedAt.
          f.metadata = {
            ...current,
            topics: kept
          };
          f.updatedAt = now;
        });
      }).filter(u => u !== null);
      await _index.default.batch([...doomed.map(t => t.prepareDestroyPermanently()), ...staged.filter(t => guarded.has(t.id)).map(t => t.prepareUpdate(row => {
        row.pendingDeleteAt = null;
        row.status = 'retired';
        row.updatedAt = now;
      })), ...factUpdates]);
    });

    // A destroyed topic changes what `getAllTopicIds()` returns, which a
    // RETIRE never did — so suggestions whose only topic evidence was this
    // topic are now unrenderable dead weight. Mirrors what `deleteFact` does
    // after a cascade. Runs only at commit, which is what keeps an undo from
    // having to resurrect suggestions.
    if (doomed.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const topics = require("./topic-service");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const suggestions = require("./article-suggestion-lifecycle");
      const purged = await suggestions.purgeSuggestionsForDeadTopics(await topics.getAllTopicIds());
      if (purged > 0) {
        _logger.default.warn('[topic-decline] Purged suggestions for deleted topics', {
          purged
        });
      }
    }
    return staged.length;
  } catch (error) {
    _logger.default.captureException(error, {
      tags: {
        service: 'topic-decline',
        method: 'flushPendingDeletes'
      }
    });
    return 0;
  }
}

/** Declined topic texts, newest first — the agent's prompt context.
 *  Returns the NORMALISED form, which is what generation filters against. */
async function getDeclinedTopicTexts(limit = DECLINED_TEXTS_LIMIT) {
  const rows = await declinedCollection.query(_watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc), _watermelondb.Q.take(limit)).fetch();
  return rows.map(r => r.normalizedText);
}

/**
 * EVERY declined normalized text, with no page limit — the veto set for
 * anything that mints topics unattended (the combination pass, and isolated
 * generation's exclusions). `getDeclinedTopicTexts` is a 50-row PROMPT page;
 * vetoing against it lets the 51st-oldest decline come back.
 */
async function getAllDeclinedNormalizedTexts() {
  const rows = await declinedCollection.query().fetch();
  return new Set(rows.map(r => r.normalizedText));
}

/** Live "Topics you removed" list, newest first. A plain `observe()` is right:
 *  rows are only created and destroyed, never edited in a way the list shows. */
function listDeclinedTopics() {
  return declinedCollection.query(_watermelondb.Q.sortBy('created_at', _watermelondb.Q.desc)).observe();
}

/**
 * Forget one decline.
 *
 * This does NOT bring the topic back — that row was destroyed when the delete
 * committed. It stops the decline suppressing future proposals, so the agent
 * may offer the interest again. Callers wanting the chip back immediately
 * should mint it via `createTopics({ factId, text })`; the row carries both.
 */
async function removeDeclineLocal(id) {
  let row;
  try {
    row = await declinedCollection.find(id);
  } catch {
    return; // already gone — a double tap, not an error
  }
  await _index.default.write(async () => {
    await _index.default.batch([row.prepareDestroyPermanently()]);
  });
}
const removeDecline = exports.removeDecline = (0, _command.command)('removeDecline', removeDeclineLocal);

/** Drops every staged delete's timer and its bookkeeping, without touching the database. A reset
 *  calls it: a flush left from before would commit the next account's own staged deletes early. */
function cancelPendingDeletes() {
  for (const e of pending.values()) if (e.timer) clearTimeout(e.timer);
  pending.clear();
}

/** Test seam: drop in-memory undo bookkeeping without touching the database. */
function __resetPendingForTests() {
  cancelPendingDeletes();
  inFlightFlush = null;
}