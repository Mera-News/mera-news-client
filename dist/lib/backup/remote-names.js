"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.REMOTE_FILENAME_PREFIX = void 0;
exports.createdAtFromRemoteFilename = createdAtFromRemoteFilename;
exports.remoteFilenameFor = remoteFilenameFor;
// Remote blob names: a timestamp and nothing else.
//
// Import-free on purpose. `BackupSection` reads dates out of these names to
// show "Last backup <date>" and to label restore points, and pulling in
// `backup-service` for that would drag expo-file-system and the whole
// WatermelonDB row source into every screen that only wants a date.
//
// The name carries no user id, device name or email because the blob may sit in
// a cloud account shared with other people.

/** Every blob this app writes starts with this, and `list` filters on it. */
const REMOTE_FILENAME_PREFIX = exports.REMOTE_FILENAME_PREFIX = 'mera-backup-';

/** Timestamp only. No user id, no device name, no email. */
function remoteFilenameFor(createdAt) {
  return `${REMOTE_FILENAME_PREFIX}${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}.bin`;
}

/**
 * The inverse of `remoteFilenameFor`, from a bare name or a full remote path.
 * Null for anything that is not one of ours, so a stray file in the folder
 * never becomes a date on screen.
 */
function createdAtFromRemoteFilename(pathOrName) {
  const name = pathOrName.split('/').pop() ?? '';
  const m = name.match(/^mera-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.bin$/);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(ms) ? ms : null;
}