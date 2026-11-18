"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.canonicalJson = canonicalJson;
exports.checkDeployedSoftware = checkDeployedSoftware;
exports.traceProxyImage = traceProxyImage;
var _sha = require("@noble/hashes/sha2.js");
var _utils = require("@noble/hashes/utils.js");
var _attestationVerify = require("./attestation-verify");
/**
 * Identifies the proxy image NEAR says it installed on the machine that answered.
 *
 * The report's measurements stop at the OS and NEAR's launcher, because the model
 * and the decrypting proxy are installed after boot. So this follows the trail NEAR
 * publishes instead: `compose-manager`'s action log, quoted with our nonce on the
 * same machine as the model's quote, names a commit and hash of a compose file in
 * NEAR's public repo, and that file pins the proxy image by digest.
 *
 * A pass says which image NEAR's log points at. It doesn't show what the image does,
 * that its source is what NEAR publishes (provenance isn't checked here), or that
 * the log's author is honest: the running compose-manager isn't measured, it's a
 * signed NEAR release the measured launcher installs.
 *
 * Same rules as the rest of the verifier: fail-open, pure apart from the injected
 * fetcher, `fail` only on proof, and anything it can't judge is `not-checked`.
 */

/** Resolves to null when the file can't be had. */

/** The same shapes the gateway relays. */
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const FILE_PATTERN = /^prod\/[A-Za-z0-9._-]+\.ya?ml$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PROXY_IMAGE_PATTERN = /^nearaidev\/vllm-proxy-rs@sha256:([0-9a-f]{64})$/;
/** Holds third-party pull jobs, and never a proxy. */
const SIDE_FILE = 'prod/sage-pull.yaml';

/** Measured: 82 actions in 16 days on one machine. */
const MAX_ACTIONS = 5000;
const MAX_FILE_BYTES = 1024 * 1024;
const SHORT_DIGEST_LEN = 12;
const MAX_MERGE_DEPTH = 4;

/** Absolute offsets in `ParsedQuote.signedBody`: MRTD then MRCONFIGID, then RTMR0-3. */
const MEASUREMENT_RANGES = [[184, 280], [376, 568]];

/** What must hold in the log's quote, once its certificate chain is good. */
const LOG_QUOTE_CHECKS = ['quote-structure', 'report-data-key', 'freshness-nonce', 'qe-report-signature', 'attestation-key-binding', 'quote-signature'];
const notChecked = detail => ({
  status: 'not-checked',
  detail
});
const failed = detail => ({
  status: 'fail',
  detail
});

/** Python's `json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`,
 *  which is how NEAR hashes the log. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** The lines nested under `lines[start]`. Comments and blanks never end a block. */
function blockAfter(lines, start) {
  const indent = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length) {
    const trimmed = lines[end].trim();
    if (trimmed && !trimmed.startsWith('#') && indentOf(lines[end]) <= indent) break;
    end += 1;
  }
  return lines.slice(start + 1, end);
}
function servicesOf(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf('services:');
  return start < 0 ? null : {
    lines,
    services: blockAfter(lines, start)
  };
}
function serviceBlock(services, name) {
  const start = services.indexOf(`  ${name}:`);
  return start < 0 ? null : blockAfter(services, start);
}
function servesModel(block, modelName) {
  return block.some(line => line.trim() === `- MODEL_NAME=${modelName}`);
}

/** The proxy service for a model, when exactly one exists. */
function proxyServiceFor(text, modelName) {
  const parsed = servicesOf(text);
  if (!parsed) return null;
  const names = parsed.services.map(line => line.match(/^ {2}(proxy-[A-Za-z0-9_.-]+):\s*$/)?.[1]).filter(name => name !== undefined).filter(name => servesModel(serviceBlock(parsed.services, name) ?? [], modelName));
  return names.length === 1 ? names[0] : null;
}

/** A key's value in a mapping nested `indent` deep, following a single `<<: *anchor`
 *  the way YAML does: a local key wins. Full YAML is not worth a dependency here,
 *  since anything this doesn't recognise reads as not-checked. */
function imageIn(lines, block, indent, depth) {
  const pad = ' '.repeat(indent);
  for (const line of block) {
    if (line.startsWith(`${pad}image:`)) return line.slice(pad.length + 'image:'.length).trim();
  }
  const merges = block.flatMap(line => {
    const name = line.startsWith(pad) ? line.slice(indent).match(/^<<:\s*\*([\w-]+)\s*$/)?.[1] : null;
    return name ? [name] : [];
  });
  if (merges.length !== 1 || depth >= MAX_MERGE_DEPTH) return null;
  const anchor = new RegExp(`^[\\w.-]+:\\s*&${merges[0]}\\s*$`);
  const start = lines.findIndex(line => anchor.test(line));
  return start < 0 ? null : imageIn(lines, blockAfter(lines, start), 2, depth + 1);
}
function namedServices(action) {
  return Array.isArray(action.services) ? action.services.filter(s => typeof s === 'string') : [];
}
function asComposeUp(action) {
  const {
    action: kind,
    commit,
    file,
    file_sha256: fileSha256
  } = action;
  if (kind !== 'compose_up' || typeof commit !== 'string' || typeof file !== 'string' || typeof fileSha256 !== 'string' || !COMMIT_PATTERN.test(commit) || !FILE_PATTERN.test(file) || !HASH_PATTERN.test(fileSha256)) {
    return null;
  }
  const tag = typeof action.tag === 'string' ? action.tag : undefined;
  return {
    commit,
    file,
    fileSha256,
    services: namedServices(action),
    tag
  };
}

/** `running` is only an up that still stands: nothing later took the service down. */
function latestUpOf(actions, service, file) {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const up = asComposeUp(actions[i]);
    if (!up || !(up.services.includes(service) || up.services.length === 0 && up.file === file)) {
      continue;
    }
    const running = !actions.slice(i + 1).some(later => {
      if (later.action !== 'compose_down') return false;
      const named = namedServices(later);
      return named.length === 0 ? later.file === up.file : named.includes(service);
    });
    return {
      up,
      running
    };
  }
  return null;
}

/**
 * Steps 4 and 5: from a verified log to the proxy image. Split out because a real
 * log can't be altered and stay signed, so its logic is tested on synthetic logs.
 */
async function traceProxyImage(actions, modelName, fetchFile) {
  const hashedFile = async up => {
    const text = await fetchFile(up.commit, up.file);
    if (text === null) return notChecked(`${up.file} could not be fetched`);
    const bytes = (0, _utils.utf8ToBytes)(text);
    if (bytes.length > MAX_FILE_BYTES) return notChecked(`${up.file} is over the size limit`);
    return (0, _attestationVerify.bytesToHex)((0, _sha.sha256)(bytes)) === up.fileSha256 ? text : failed(`${up.file} at ${up.commit} doesn't match the hash in the signed log`);
  };
  const newest = actions.map(asComposeUp).filter(up => up !== null && up.file !== SIDE_FILE).at(-1);
  if (!newest) return notChecked('the log names no deployment file');
  const newestText = await hashedFile(newest);
  if (typeof newestText !== 'string') return newestText;
  const service = proxyServiceFor(newestText, modelName);
  if (!service) return notChecked(`no single proxy service serves ${modelName}`);
  const latest = latestUpOf(actions, service, newest.file);
  if (!latest) return notChecked(`the log never started ${service}`);
  if (!latest.running) return notChecked(`the log shows ${service} was stopped`);
  const sameFile = latest.up.commit === newest.commit && latest.up.file === newest.file;
  const text = sameFile ? newestText : await hashedFile(latest.up);
  if (typeof text !== 'string') return text;
  const parsed = servicesOf(text);
  const block = parsed && serviceBlock(parsed.services, service);
  if (!parsed || !block || !servesModel(block, modelName)) {
    return notChecked(`${service} isn't in the file that started it`);
  }
  const image = imageIn(parsed.lines, block, 4, 0);
  const digest = image?.match(PROXY_IMAGE_PATTERN)?.[1];
  if (!digest) return notChecked(`${service} doesn't pin a proxy image by digest`);
  return {
    status: 'pass',
    detail: `nearaidev/vllm-proxy-rs@sha256:${digest.slice(0, SHORT_DIGEST_LEN)}, from ${latest.up.file} at ${latest.up.commit.slice(0, SHORT_DIGEST_LEN)}`,
    proxy: {
      image: `nearaidev/vllm-proxy-rs@sha256:${digest}`,
      file: latest.up.file,
      commit: latest.up.commit,
      tag: latest.up.tag
    }
  };
}

/** Steps 1 to 3: the log is Intel-quoted, fresh and from the model's own machine. */
function checkLogQuote(quote, actionsHash, input) {
  const {
    checks
  } = (0, _attestationVerify.verifyAttestation)({
    quoteHex: quote,
    signingPublicKey: actionsHash,
    expectedNonce: input.expectedNonce,
    now: input.now
  });
  const statusOf = id => checks.find(check => check.id === id)?.status;
  if (statusOf('pck-chain') !== 'pass' || statusOf('root-ca-pin') !== 'pass') {
    return notChecked("the log's quote has no valid Intel chain");
  }
  const bad = LOG_QUOTE_CHECKS.find(id => statusOf(id) !== 'pass');
  if (bad) return failed(`the log's quote failed ${bad}`);
  const logBody = (0, _attestationVerify.parseQuote)(quote).signedBody;
  const modelBody = (0, _attestationVerify.parseQuote)(input.modelQuoteHex).signedBody;
  const measurements = body => MEASUREMENT_RANGES.map(([from, to]) => (0, _attestationVerify.bytesToHex)(body.subarray(from, to))).join();
  return measurements(logBody) === measurements(modelBody) ? null : failed("the log's quote comes from a different machine than the model's");
}

/** Never throws: a settings screen has to render something either way. */
async function checkDeployedSoftware(input, fetchFile) {
  const raw = input.composeManagerAttestation;
  if (!raw || typeof raw !== 'object') return notChecked('no deployment log was served');
  const {
    quote,
    actions,
    actions_hash: actionsHash
  } = raw;
  if (typeof quote !== 'string' || typeof actionsHash !== 'string' || !HASH_PATTERN.test(actionsHash) || !Array.isArray(actions)) {
    return notChecked('the deployment log is incomplete');
  }
  if (actions.length > MAX_ACTIONS) return notChecked('the deployment log is over the size limit');
  try {
    const quoteProblem = checkLogQuote(quote, actionsHash, input);
    if (quoteProblem) return quoteProblem;
    if ((0, _attestationVerify.bytesToHex)((0, _sha.sha256)((0, _utils.utf8ToBytes)(canonicalJson(actions)))) !== actionsHash) {
      return failed("the deployment log doesn't match the hash in its quote");
    }
    return await traceProxyImage(actions, input.modelName, fetchFile);
  } catch (e) {
    return notChecked(`the deployment log could not be read: ${e.message}`);
  }
}