"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createMarkBatch = createMarkBatch;
exports.recordMark = exports.defaultMarkBatch = void 0;
var _tables = require("./tables");
const empty = () => ({
  opens: [],
  visits: [],
  seen: [],
  watermarks: [],
  cardState: null
});

/** The local-first batch of display marks, held until the next flush. */
function createMarkBatch() {
  let batch = empty();
  const listeners = new Set();
  const recordMark = (kind, payload) => {
    if (kind === 'open') batch.opens.push(payload);else if (kind === 'visit') batch.visits.push(payload);else if (kind === 'seen') batch.seen.push(payload);else if (kind === 'watermark') batch.watermarks.push(payload);else batch.cardState = payload; // last value wins
    for (const l of listeners) l(kind === 'cardState' ? new Set() : new Set([_tables.MARK_TABLES[kind]]));
  };
  return {
    recordMark,
    hasPending,
    pendingTables,
    /** Empties the batch. `batch` is null when nothing was marked. */
    takeBatch() {
      const tables = pendingTables();
      const taken = hasPending() ? batch : null;
      batch = empty();
      return {
        batch: taken,
        tables
      };
    },
    onMark(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  function pendingTables() {
    const t = new Set();
    if (batch.opens.length) t.add(_tables.MARK_TABLES.open);
    if (batch.visits.length) t.add(_tables.MARK_TABLES.visit);
    if (batch.seen.length || batch.watermarks.length) t.add(_tables.MARK_TABLES.seen);
    return t;
  }

  // Card state is applied nowhere, so it has no table but still has to be sent.
  function hasPending() {
    return pendingTables().size > 0 || batch.cardState !== null;
  }
}
/** The batch the app's mark writers append to. */
const defaultMarkBatch = exports.defaultMarkBatch = createMarkBatch();
const recordMark = exports.recordMark = defaultMarkBatch.recordMark;