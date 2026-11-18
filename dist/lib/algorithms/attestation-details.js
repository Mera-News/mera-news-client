"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.attestationDetails = attestationDetails;
var _attestationVerify = require("./attestation-verify");
/**
 * The facts behind one Verify tap, for the details card and its copy button.
 *
 * Every value is public attestation data, so nothing here can identify the reader.
 * `osImageHash` is the one value no signature covers: it comes from the report's
 * unsigned `info`, and the card labels it as reported.
 */

const HASH_PATTERN = /^[0-9a-f]{64}$/;
function reportedOsImageHash(info) {
  const hash = info?.os_image_hash;
  return typeof hash === 'string' && HASH_PATTERN.test(hash) ? hash : undefined;
}
function attestationDetails(input) {
  const {
    report,
    proxy
  } = input;
  const check = id => report.checks.find(c => c.id === id);
  return {
    checkedAt: input.checkedAt.toISOString(),
    nonce: input.nonce,
    encryptionKey: input.signingPublicKey || undefined,
    algorithm: input.signingAlgo || undefined,
    ...(0, _attestationVerify.quoteMeasurements)(input.quoteHex),
    osImageHash: reportedOsImageHash(input.info),
    patchLevel: check('tcb-status')?.status,
    gpuCount: check('gpu-attestation')?.gpuCount,
    proxyImage: proxy?.image,
    composeFile: proxy?.file,
    composeTag: proxy?.tag,
    composeCommit: proxy?.commit
  };
}