"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BackupImportError = void 0;
exports.importBackup = importBackup;
exports.inspectBackup = inspectBackup;
exports.knownColumns = knownColumns;
var pako = _interopRequireWildcard(require("pako"));
var _allowlist = require("./allowlist");
var _blob = require("./blob");
var _export = require("./export");
var _schema = _interopRequireDefault(require("../database/schema"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var cache;
function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var r, c, a = Object.defineProperty, n = { __proto__: null, default: e }; if (Object(e) !== e) return n; if (cache || "function" != typeof WeakMap || (cache = new WeakMap()), cache) { if (cache.has(e)) return cache.get(e); cache.set(e, n); } for (c in e) "default" !== c && {}.hasOwnProperty.call(e, c) && ((r = a && Object.getOwnPropertyDescriptor(e, c)) && (r.get || r.set) ? a(n, c, r) : n[c] = e[c]); return n; }
// Reading a backup: authenticated frames → inflate → NDJSON → batched writes.
//
// The mirror of `export.ts`, and it refuses far more than it accepts.
//
// **A valid signature is not a promise that the writer was correct.** The AEAD
// proves nobody tampered with the blob after it was sealed; it proves nothing
// about the build that sealed it. So every settings key is re-filtered through
// `isBackedUpSettingKey` on the way IN, not only on the way out. A blob written
// by a build with a broken allowlist — or by hand — must not be able to write
// `cached_user_id`, because identity-gate reads that key and a foreign value
// triggers `wipeAndProceed`, destroying the very restore that wrote it.
//
// **`settings` is not cleared and not created, it is upserted by key.** Every
// other backed-up table is wiped and rewritten, which is what makes a restore
// deterministic and re-runnable. Wiping `settings` would take device-scoped
// keys with it — `cached_user_id`, `needs_reauth`, the PIN preference — and
// those belong to the device the restore is landing on, not to the blob.
//
// **A restore is not atomic and is not pretending to be.** 70k rows cannot go
// through one WatermelonDB `batch()`, so writes are chunked and a crash lands
// mid-restore. That is what the torn-restore marker is for: `beginRestore`
// sets it and `finishRestore` clears it, so the next launch can tell a finished
// restore from an interrupted one rather than booting a half-written persona.
//
// IO, the database and the current schema are all injected. `lib/backup` stays
// free of native modules.

/** Column names per table, from the LIVE schema, for the importer's drift check. */
function knownColumns() {
  const out = {};
  for (const [table, def] of Object.entries(_schema.default.tables)) {
    out[table] = Object.keys(def.columns);
  }
  return out;
}

/** Rows per `batch()` call. Bounded so one write is never a huge allocation. */
const WRITE_BATCH_ROWS = 500;
const NEWLINE = 0x0a;
class BackupImportError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
    this.name = 'BackupImportError';
  }
}

// ---- ports ----------------------------------------------------------------

/**
 * The write seam. `watermelon-row-sink.ts` is the production implementation;
 * tests use an in-memory double.
 */
exports.BackupImportError = BackupImportError;
// ---- header inspection ----------------------------------------------------

/**
 * Parses the header and nothing else, so a restore preview ("backup from
 * <date>, 1,204 facts") costs a header read rather than a full decrypt.
 * Refusals surface as `BlobFormatError`, whose `reason` is a `RestoreRefusal`.
 */
async function inspectBackup(key, blob) {
  return (await (0, _blob.openBlob)(key, blob)).header;
}

// ---- line splitting -------------------------------------------------------

/**
 * Splits inflate output into NDJSON lines at the BYTE level.
 *
 * Deliberately not `TextDecoder(..., {stream: true})`: streaming decode support
 * is uneven across engines and a chunk boundary landing mid-character would
 * corrupt a line silently. Splitting on 0x0A first is safe unconditionally,
 * because a UTF-8 continuation byte is always >= 0x80 and so `\n` can never
 * appear inside a multibyte sequence. Each complete line is then decoded whole.
 */
class LineSplitter {
  constructor() {
    this.carry = new Uint8Array(0);
    this.decoder = new TextDecoder();
  }
  push(chunk) {
    const buf = new Uint8Array(this.carry.length + chunk.length);
    buf.set(this.carry, 0);
    buf.set(chunk, this.carry.length);
    const lines = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== NEWLINE) continue;
      if (i > start) lines.push(this.decoder.decode(buf.subarray(start, i)));
      start = i + 1;
    }
    this.carry = buf.slice(start);
    return lines;
  }

  /** Any trailing bytes with no final newline. The exporter always ends with
   * one, so a non-empty flush means a truncated or hand-made blob. */
  flush() {
    if (this.carry.length === 0) return [];
    const last = this.decoder.decode(this.carry);
    this.carry = new Uint8Array(0);
    return [last];
  }
}

// ---- row shaping ----------------------------------------------------------

/**
 * Narrows a row to the columns this build's schema has. A column the blob
 * carries and this build lacks means the blob is from a newer schema; handing
 * it to WatermelonDB would reject the whole batch, so it is dropped and named
 * in the result. A column this build has and the blob lacks needs nothing:
 * migrations are additive by invariant, so it is optional or defaulted.
 */
function shapeRow(row, known) {
  const allowed = new Set([...known, 'id']);
  const out = {};
  const dropped = [];
  for (const [k, v] of Object.entries(row)) {
    if (allowed.has(k)) out[k] = v;else dropped.push(k);
  }
  return {
    row: out,
    dropped
  };
}

// ---- entry point ----------------------------------------------------------

/**
 * Restores one backup. Throws `BackupImportError` or `BlobFormatError`; either
 * way `reason` is a `RestoreRefusal` and the caller has one message per reason.
 *
 * On any throw the torn-restore marker is left SET on purpose. A restore that
 * failed halfway has genuinely torn the local data, and pretending otherwise
 * boots the user into a mixture of two personas.
 */
async function importBackup(options) {
  // Pass 1 reads the whole blob (header, every frame, every auth tag) into a sink that writes
  // nothing, so a blob that fails part-way cannot clear the persona it was meant to replace.
  // The blob is random access, so pass 2 re-reads it; nothing is buffered between the passes.
  await restore({
    ...options,
    sink: DISCARD_SINK,
    onProgress: undefined
  });
  return restore(options);
}
const DISCARD_SINK = {
  beginRestore: async () => {},
  clearTables: async () => {},
  createRows: async () => {},
  upsertSettings: async () => {},
  finishRestore: async () => {},
  abortRestore: async () => {}
};
async function restore(options) {
  const {
    key,
    blob,
    sink,
    knownColumns,
    schemaVersion,
    onProgress
  } = options;
  const opened = await (0, _blob.openBlob)(key, blob);
  const header = opened.header;
  const fromNewerSchema = header.schemaVersion > schemaVersion;

  // Tables the blob declares and this build does not have. Only reachable from
  // a newer blob, and skipping them is the only option — there is no table to
  // write them to.
  const skippedTables = header.tables.map(t => t.table).filter(t => t !== 'settings' && !(t in knownColumns));

  // Cleared from the ALLOWLIST, never from the blob's own table list. A restore
  // replaces the persona; deriving this from `header.tables[]` would let a blob
  // declaring a subset write itself on top of the tables it did not declare,
  // which is the mixed persona this whole lifecycle exists to prevent.
  const clearable = _allowlist.RESTORE_REPLACED_TABLES.filter(t => t in knownColumns);
  const perTable = {};
  const droppedColumns = {};
  const refusedSettingKeys = [];
  let rowsRestored = 0;

  // AUTHENTICATE BEFORE CLEARING ANYTHING. `openBlob` parses the header, which
  // is cleartext, and decrypts nothing — the first frame is only opened when
  // the iterator is pulled. Clearing first meant a mistyped recovery code wiped
  // the user's local data and THEN reported `wrong-key`, which is the single
  // worst thing this file could do. So the first frame is pulled here, outside
  // the try, while the sink is still untouched.
  const frames = opened.frames();
  const first = await frames.next();
  await sink.beginRestore();
  try {
    await sink.clearTables(clearable);
    const splitter = new LineSplitter();
    const inflate = new pako.Inflate();
    const inflated = [];
    inflate.onData = chunk => {
      inflated.push(chunk);
    };
    let currentTable = null;
    let declared = 0;
    let seen = 0;
    let pending = [];
    const flush = async () => {
      if (!currentTable || pending.length === 0) return;
      const table = currentTable;
      const rows = pending;
      pending = [];
      if (table === 'settings') {
        await sink.upsertSettings(rows.map(r => ({
          key: String(r.key),
          value: r.value
        })));
      } else {
        await sink.createRows(table, rows);
      }
      perTable[table] = (perTable[table] ?? 0) + rows.length;
      rowsRestored += rows.length;
      onProgress?.({
        table,
        rowsRestored
      });
    };
    const endSection = () => {
      if (currentTable && seen !== declared) {
        throw new BackupImportError('tampered', `Section ${currentTable} declared ${declared} rows but carried ${seen}`);
      }
    };
    const handleLine = async line => {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new BackupImportError('tampered', 'Backup contains a line that is not JSON');
      }
      if (typeof parsed[_export.SECTION_TABLE_KEY] === 'string') {
        await flush();
        endSection();
        currentTable = parsed[_export.SECTION_TABLE_KEY];
        declared = Number(parsed[_export.SECTION_ROWS_KEY] ?? 0);
        seen = 0;
        return;
      }
      if (!currentTable) {
        throw new BackupImportError('tampered', 'Backup has a row before any section marker');
      }
      seen += 1;
      if (currentTable === 'settings') {
        const settingKey = String(parsed.key ?? '');
        // Re-filtered on the way IN. See the header comment: a signature says
        // nothing about whether the writer was a correct build.
        if (!(0, _allowlist.isBackedUpSettingKey)(settingKey)) {
          refusedSettingKeys.push(settingKey);
          return;
        }
        // `id` is deliberately not carried: the upsert matches on `key` and an
        // existing row keeps its own id.
        pending.push({
          key: settingKey,
          value: parsed.value
        });
      } else {
        // Only the tables a restore replaces. A table this build lacks is in skippedTables; one the
        // backup never carries (scheduler_jobs...) is never cleared first, so it is not written either.
        if (!clearable.includes(currentTable)) return;
        const {
          row,
          dropped
        } = shapeRow(parsed, knownColumns[currentTable]);
        if (dropped.length > 0) {
          const seenForTable = droppedColumns[currentTable] ??= new Set();
          for (const c of dropped) seenForTable.add(c);
        }
        if (typeof row.id !== 'string' || row.id === '') {
          throw new BackupImportError('tampered', `A ${currentTable} row has no id; restoring it would break every reference to it`);
        }
        pending.push(row);
      }
      if (pending.length >= WRITE_BATCH_ROWS) await flush();
    };
    let inflatedBytes = 0;
    const feed = async (frame, isLast) => {
      inflate.push(frame, isLast);
      // pako 3 reports a stream that ends early on the final push as Z_BUF_ERROR
      // (pako 2 left err at 0); that is a cut-short backup, not a forged one.
      if (isLast && inflate.err === pako.Z_BUF_ERROR) {
        throw new BackupImportError('incomplete', `deflate stream ended early: ${inflate.msg}`);
      }
      if (inflate.err) {
        throw new BackupImportError('tampered', `inflate failed (${inflate.err}): ${inflate.msg}`);
      }
      while (inflated.length > 0) {
        const chunk = inflated.shift();
        inflatedBytes += chunk.length;
        for (const line of splitter.push(chunk)) await handleLine(line);
      }
    };

    // One frame is held back, mirroring the exporter's held CHUNK, so the final
    // push carries `true` rather than `push(empty, true)` after the loop —
    // pako's behaviour once a stream has ended is not something to build a
    // restore on.
    let heldFrame = first.done ? null : first.value;
    if (!first.done) {
      for (;;) {
        const next = await frames.next();
        if (next.done) break;
        await feed(heldFrame, false);
        heldFrame = next.value;
      }
    }
    await feed(heldFrame ?? new Uint8Array(0), true);
    for (const line of splitter.flush()) await handleLine(line);

    // The blob's last-frame flag proves the CIPHERTEXT arrived whole; it says
    // nothing about the deflate stream inside it. A stream cut at a deflate
    // block boundary can still inflate cleanly to less output, so the byte
    // count the exporter recorded stays the final check. This is what
    // `header.plaintextBytes` is for.
    if (inflatedBytes !== header.plaintextBytes) {
      throw new BackupImportError('incomplete', `Backup declared ${header.plaintextBytes} bytes of content but yielded ${inflatedBytes}`);
    }
    await flush();
    endSection();
    await sink.finishRestore();
  } catch (err) {
    await sink.abortRestore();
    throw err;
  }
  return {
    header,
    rowsRestored,
    perTable,
    skippedTables,
    droppedColumns: Object.fromEntries(Object.entries(droppedColumns).map(([t, s]) => [t, [...s].sort()])),
    refusedSettingKeys,
    fromNewerSchema
  };
}