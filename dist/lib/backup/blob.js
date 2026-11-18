"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BlobWriter = exports.BlobFormatError = void 0;
exports.openBlob = openBlob;
var _chacha = require("@noble/ciphers/chacha.js");
var _utils = require("@noble/ciphers/utils.js");
var _sha = require("@noble/hashes/sha2.js");
var _types = require("./types");
// The backup blob format: a cleartext header followed by authenticated frames.
//
// Layout
//
//   [4]  header length, big-endian
//   [n]  header JSON (UTF-8, cleartext — see BackupHeader for why it holds no
//        identifying fields)
//   ...  frames, each: [4] ciphertext length BE, then the ciphertext
//
// Each frame is XChaCha20-Poly1305 over one gzip chunk, with `SHA-256(header)`
// as additional authenticated data, under a STREAM-construction nonce:
//
//   nonce = prefix(19) ‖ counter(4, BE) ‖ lastFrameFlag(1)
//
// That nonce is what makes the format resist the three attacks a per-frame AEAD
// alone does not:
//
//   * reordering  — the counter is authenticated, so a swapped frame fails
//   * truncation  — only the real final frame carries flag=1, so a blob cut
//                   short never presents one and is rejected as incomplete
//   * substitution across blobs — the prefix is per-blob and in the header,
//                   and the header is the AAD, so a frame from another backup
//                   cannot be spliced in
//
// Tampering with any header byte changes the AAD and fails EVERY frame, which is
// the behaviour we want: the header is not separately signed, it is load-bearing
// for the whole blob.
//
// IO is injected rather than imported. `lib/backup` stays free of native modules
// so this is testable in Node against an in-memory buffer, and the exporter
// supplies the RNFS-backed implementation. Verified ON DEVICE on both platforms
// (iOS 26.5.2 and Android 33) that `RNFS.write(path, b64, position, 'base64')`
// places bytes at a BYTE offset, not at an offset into the base64 TEXT, so the
// sequential-position writing below is sound. `dev-probe.ts` is the check.

const NONCE_PREFIX_BYTES = 19;
const COUNTER_BYTES = 4;
const FLAG_BYTES = 1;
/** XChaCha20 nonce width: 19 + 4 + 1. */
const NONCE_BYTES = NONCE_PREFIX_BYTES + COUNTER_BYTES + FLAG_BYTES;
const LENGTH_PREFIX_BYTES = 4;
/** Poly1305 tag. A frame is never smaller than this. */
const TAG_BYTES = 16;

/** Bytes written at a position. The exporter backs this with RNFS. */

/** Bytes read at a position. Returns fewer than `length` only at EOF. */

class BlobFormatError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
    this.name = 'BlobFormatError';
  }
}

// ---- helpers --------------------------------------------------------------
exports.BlobFormatError = BlobFormatError;
function u32be(n) {
  const out = new Uint8Array(4);
  out[0] = n >>> 24 & 0xff;
  out[1] = n >>> 16 & 0xff;
  out[2] = n >>> 8 & 0xff;
  out[3] = n & 0xff;
  return out;
}
function readU32be(b, at) {
  return (b[at] << 24 | b[at + 1] << 16 | b[at + 2] << 8 | b[at + 3]) >>> 0;
}

/**
 * `prefix ‖ counter ‖ isLast`. The flag is part of the nonce rather than the
 * plaintext so it is authenticated without costing a byte of ciphertext, and so
 * a reader cannot be tricked into treating a middle frame as the last one.
 */
function frameNonce(prefix, counter, isLast) {
  const nonce = new Uint8Array(NONCE_BYTES);
  nonce.set(prefix, 0);
  nonce.set(u32be(counter), NONCE_PREFIX_BYTES);
  nonce[NONCE_PREFIX_BYTES + COUNTER_BYTES] = isLast ? 1 : 0;
  return nonce;
}
function encodeHeader(header, noncePrefixB64) {
  const json = JSON.stringify({
    ...header,
    noncePrefix: noncePrefixB64
  });
  return new TextEncoder().encode(json);
}

// ---- writer ---------------------------------------------------------------

/**
 * Streams frames into a sink. One instance writes one blob.
 *
 * The header must be complete before the first frame, because it is the AAD.
 * That is why the exporter counts rows in a first pass rather than filling
 * `header.tables` as it goes — a header rewritten at the end would invalidate
 * every frame already authenticated against the old one.
 */
class BlobWriter {
  constructor(key, sink, header, /** Injectable only so tests can pin a nonce prefix. Never pass in production. */
  prefix = (0, _utils.randomBytes)(NONCE_PREFIX_BYTES)) {
    this.key = key;
    this.sink = sink;
    this.position = 0;
    this.counter = 0;
    this.finished = false;
    this.prefix = void 0;
    this.aad = void 0;
    this.pending = void 0;
    this.prefix = prefix;
    const headerBytes = encodeHeader(header, btoa(String.fromCharCode(...prefix)));
    this.aad = (0, _sha.sha256)(headerBytes);
    this.pending = {
      headerBytes
    };
  }
  /** Writes the length-prefixed header. Called once, before the first frame. */
  async writeHeaderOnce() {
    if (!this.pending) return;
    const {
      headerBytes
    } = this.pending;
    this.pending = null;
    await this.sink.write(u32be(headerBytes.length), this.position);
    this.position += LENGTH_PREFIX_BYTES;
    await this.sink.write(headerBytes, this.position);
    this.position += headerBytes.length;
  }

  /**
   * Seal one chunk. `isLast` must be true for exactly one call, and it is what
   * a reader uses to tell a complete blob from a truncated one.
   */
  async writeFrame(plaintext, isLast) {
    if (this.finished) {
      throw new Error('BlobWriter: writeFrame after the final frame');
    }
    await this.writeHeaderOnce();
    const nonce = frameNonce(this.prefix, this.counter, isLast);
    const ct = (0, _chacha.xchacha20poly1305)(this.key, nonce, this.aad).encrypt(plaintext);
    await this.sink.write(u32be(ct.length), this.position);
    this.position += LENGTH_PREFIX_BYTES;
    await this.sink.write(ct, this.position);
    this.position += ct.length;
    this.counter += 1;
    if (isLast) this.finished = true;
  }

  /** Total bytes written so far, for the size cap. */
  get bytesWritten() {
    return this.position;
  }
  get wroteFinalFrame() {
    return this.finished;
  }
}

// ---- reader ---------------------------------------------------------------
exports.BlobWriter = BlobWriter;
/**
 * Parse the header and return a frame iterator. Nothing is decrypted here — a
 * caller that only wants to show "backup from <date>, N articles" pays for the
 * header alone.
 */
async function openBlob(key, source) {
  const size = await source.size();
  if (size < LENGTH_PREFIX_BYTES) {
    throw new BlobFormatError('incomplete', 'File is too small to contain a header');
  }
  const headerLen = readU32be(await source.read(LENGTH_PREFIX_BYTES, 0), 0);
  if (headerLen === 0 || headerLen > size - LENGTH_PREFIX_BYTES) {
    throw new BlobFormatError('incomplete', `Header length ${headerLen} exceeds the file`);
  }
  const headerBytes = await source.read(headerLen, LENGTH_PREFIX_BYTES);
  const aad = (0, _sha.sha256)(headerBytes);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    // A header that will not parse is indistinguishable from a tampered one,
    // and saying "tampered" is the safer of the two for the user.
    throw new BlobFormatError('tampered', 'Header is not valid JSON');
  }
  if (typeof parsed.formatVersion !== 'number') {
    throw new BlobFormatError('tampered', 'Header has no formatVersion');
  }
  if (parsed.formatVersion > _types.BACKUP_FORMAT_VERSION) {
    throw new BlobFormatError('format-too-new', `Blob is format ${parsed.formatVersion}; this build reads ${_types.BACKUP_FORMAT_VERSION}`);
  }
  if (typeof parsed.noncePrefix !== 'string') {
    throw new BlobFormatError('tampered', 'Header has no nonce prefix');
  }
  const prefix = Uint8Array.from(atob(parsed.noncePrefix), c => c.charCodeAt(0));
  if (prefix.length !== NONCE_PREFIX_BYTES) {
    throw new BlobFormatError('tampered', 'Nonce prefix is the wrong length');
  }
  const firstFrameAt = LENGTH_PREFIX_BYTES + headerLen;
  async function* frames() {
    let position = firstFrameAt;
    let counter = 0;
    let sawFinal = false;
    while (position < size) {
      if (position + LENGTH_PREFIX_BYTES > size) {
        throw new BlobFormatError('incomplete', 'File ends inside a frame length');
      }
      const ctLen = readU32be(await source.read(LENGTH_PREFIX_BYTES, position), 0);
      position += LENGTH_PREFIX_BYTES;
      if (ctLen < TAG_BYTES || position + ctLen > size) {
        throw new BlobFormatError('incomplete', `Frame ${counter} claims ${ctLen}B beyond EOF`);
      }
      const ct = await source.read(ctLen, position);
      position += ctLen;

      // Which flag this frame carries is not known in advance, so try
      // not-last first (the common case) and fall back to last. Both are
      // authenticated, so a wrong guess simply fails to open — it cannot
      // produce plaintext.
      const atEof = position >= size;
      let plain = null;
      let isLast = false;
      for (const candidate of atEof ? [true, false] : [false, true]) {
        try {
          plain = (0, _chacha.xchacha20poly1305)(key, frameNonce(prefix, counter, candidate), aad).decrypt(ct);
          isLast = candidate;
          break;
        } catch {
          // try the other flag
        }
      }
      if (!plain) {
        // Wrong key, tampered ciphertext, a swapped frame (wrong counter) and a
        // frame from another blob (wrong prefix/AAD) are all indistinguishable
        // here by design — the tag says "no" without saying why.
        throw new BlobFormatError(counter === 0 ? 'wrong-key' : 'tampered', `Frame ${counter} failed authentication`);
      }
      if (sawFinal) {
        throw new BlobFormatError('tampered', 'Data follows the final frame');
      }
      if (isLast) sawFinal = true;
      counter += 1;
      yield plain;
    }
    if (!sawFinal) {
      // The blob was cut short: every frame authenticated, but the one marked
      // final never arrived. This is the case a per-frame AEAD alone misses.
      throw new BlobFormatError('incomplete', 'Blob ended without a final frame');
    }
  }
  const {
    noncePrefix: _ignored,
    ...header
  } = parsed;
  return {
    header: header,
    frames
  };
}