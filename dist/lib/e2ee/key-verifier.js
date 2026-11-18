"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.realKeyVerifier = void 0;
exports.setKeyVerifier = setKeyVerifier;
exports.verifyKey = void 0;
var _attestationVerify = require("../algorithms/attestation-verify");
// The hot-path key check, in its own pure module so the mock gateway can swap it
// without importing e2ee-service: that file pulls better-auth in, and the integration setup
// loads the mock before msw patches fetch.

/** Decides whether a served key may be used: the failing checks, empty to pass. */

const realKeyVerifier = input => (0, _attestationVerify.hotPathFailures)((0, _attestationVerify.verifyAttestation)(input));
exports.realKeyVerifier = realKeyVerifier;
let current = realKeyVerifier;
const verifyKey = input => current(input);

/**
 * Swap the verifier; no argument restores the real one. Exists for the mock gateway, whose test
 * keys carry no Intel quote (test/mock-backend/gateway/crypto.ts accepts exactly those keys and
 * hands every other key to the real verifier). Production never calls it.
 */
exports.verifyKey = verifyKey;
function setKeyVerifier(next) {
  current = next ?? realKeyVerifier;
}