"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.attestProfile = attestProfile;
exports.attestationCacheKey = void 0;
exports.prepareForProfile = prepareForProfile;
exports.providerHeader = void 0;
exports.rebuildForProfile = rebuildForProfile;
exports.sealMessages = sealMessages;
var _e2eeService = require("../e2ee/e2ee-service");
// The E2EE entry points for one profile: the key fetch, the context and the sealed messages,
// each told which provider holds the model. The one place lib/llm hands a provider to lib/e2ee.

/** The header that tells the gateway which provider to proxy to. Absent means near (old builds). */
const providerHeader = profile => ({
  'X-Mera-Provider': profile.provider
});

/** The attestation cache's key for `profile`. Mirrors lib/e2ee's own rule: NEAR keeps the bare model id. */
exports.providerHeader = providerHeader;
const attestationCacheKey = profile => profile.provider === 'near' ? profile.model : `${profile.provider}:${profile.model}`;
exports.attestationCacheKey = attestationCacheKey;
function attestProfile(profile, lane = 'background', opts = {}) {
  return (0, _e2eeService.fetchModelPublicKey)(profile.model, lane, opts, profile.provider);
}
function prepareForProfile(profile, lane = 'background', opts = {}, purpose) {
  return (0, _e2eeService.prepareE2EEContext)(profile.model, lane, opts, purpose, profile.provider);
}
function rebuildForProfile(profile, privKeyHex, algo, lane = 'background', opts = {}) {
  return (0, _e2eeService.rebuildE2EEContext)(profile.model, privKeyHex, algo, lane, opts, profile.provider);
}

/** `encryptMessages` for one profile: fail-closed field checks, then every non-empty content sealed in place. */
function sealMessages(messages, profile, lane = 'background', purpose) {
  return (0, _e2eeService.encryptMessages)(messages, profile.model, lane, purpose, profile.provider);
}