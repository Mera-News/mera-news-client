"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.clearAttestationCache = clearAttestationCache;
exports.getCachedAttestation = getCachedAttestation;
exports.invalidateCachedAttestation = invalidateCachedAttestation;
exports.markKeyVerified = exports.isKeyVerified = void 0;
exports.setCachedAttestation = setCachedAttestation;
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const cache = new Map();

/** Keys whose attestation passed the hot-path check, as `provider:keyHex`. A key proven once
 *  stays proven, so a TTL refetch serving the same key does not verify the quote again. */
const verifiedKeys = new Set();
const isKeyVerified = id => verifiedKeys.has(id);
exports.isKeyVerified = isKeyVerified;
const markKeyVerified = id => {
  verifiedKeys.add(id);
};

/** Return cached model attestation for `model` if still valid. */
exports.markKeyVerified = markKeyVerified;
function getCachedAttestation(model) {
  const entry = cache.get(model);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(model);
    return null;
  }
  return entry.attestation;
}
function setCachedAttestation(model, attestation) {
  cache.set(model, {
    attestation,
    fetchedAt: Date.now()
  });
}

/**
 * Drop ONE model's cached attestation so the next `fetchModelPublicKey` re-attests.
 *
 * Exists for the case where a key is still inside its TTL but the serving node
 * will not decrypt under it: NEAR answers a chat POST with
 * `400 "Provider failed for model '<id>': Decryption failed"`, which is its own
 * verdict passed through by the gateway (a pure proxy). Re-attesting is the only
 * client-side lever — it re-rolls both the node we are keyed against and, since
 * NEAR's fleet load-balances curves, possibly the algo family itself.
 *
 * Deliberately per-model rather than reusing `clearAttestationCache`: the other
 * models' keys are not implicated, and wiping them would make every concurrent
 * caller re-attest against the same endpoint (the stampede `pendingAttestations`
 * exists to prevent).
 */
function invalidateCachedAttestation(model) {
  cache.delete(model);
}

/**
 * Wipe the in-memory attestation cache. Called from `clearAllStores()` on
 * logout / account switch so a different user's session cannot reuse a
 * previous user's attestation.
 */
function clearAttestationCache() {
  cache.clear();
  verifiedKeys.clear();
}