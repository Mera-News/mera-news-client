"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.HARNESS_MAPPING = exports.HARNESS_FILES = void 0;
exports.harnessFolderFor = harnessFolderFor;
exports.loadHarness = loadHarness;
var _mapping = _interopRequireDefault(require("./mapping.json"));
var _harness = _interopRequireDefault(require("./cloud-base/harness.json"));
var _harness2 = _interopRequireDefault(require("./device-base/harness.json"));
var _harness3 = _interopRequireDefault(require("./qwen3.8-27b/harness.json"));
var _harness4 = _interopRequireDefault(require("./qwen3.6-35b-a3b/harness.json"));
var _harness5 = _interopRequireDefault(require("./afm/harness.json"));
var _harness6 = _interopRequireDefault(require("./gemma-4-31b/harness.json"));
var _harness7 = _interopRequireDefault(require("./kimi-k2.6/harness.json"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The harness registry loader: reads every folder's harness.json and resolves `extends` chains.
// Static imports, because Metro cannot read a directory at runtime. A new folder is one line here
// and one mapping.json entry; the guard test fails if either is missing.

const HARNESS_FILES = exports.HARNESS_FILES = {
  'cloud-base': _harness.default,
  'device-base': _harness2.default,
  'qwen3.8-27b': _harness3.default,
  'qwen3.6-35b-a3b': _harness4.default,
  afm: _harness5.default,
  'gemma-4-31b': _harness6.default,
  'kimi-k2.6': _harness7.default
};

/** `<provider>:<provider model id>` -> harness folder. */
const HARNESS_MAPPING = exports.HARNESS_MAPPING = _mapping.default;
const resolved = new Map();

/** The harness in `folder` with its whole `extends` chain applied. Throws on an unknown folder or a cycle. */
function loadHarness(folder) {
  const hit = resolved.get(folder);
  if (hit) return hit;
  const chain = [];
  for (let at = folder; at !== null; at = HARNESS_FILES[at].extends) {
    if (!HARNESS_FILES[at]) throw new Error(`harness "${at}" not found (from "${folder}")`);
    if (chain.includes(at)) throw new Error(`harness extends cycle: ${[...chain, at].join(' -> ')}`);
    chain.unshift(at);
  }
  const files = chain.map(f => HARNESS_FILES[f]);
  // Per-lane maps merge key by key; every other param is replaced whole by the later file.
  const params = files.reduce((acc, f) => ({
    ...acc,
    ...f.params,
    maxTokens: {
      ...acc.maxTokens,
      ...f.params.maxTokens
    },
    firstTokenDeadlineMs: {
      ...acc.firstTokenDeadlineMs,
      ...f.params.firstTokenDeadlineMs
    }
  }), {});
  const harness = {
    folder,
    chain,
    params,
    lanes: files.reduce((acc, f) => f.lanes ?? acc, [])
  };
  resolved.set(folder, harness);
  return harness;
}

/** The harness folder for one provider's model id, or null when no folder is mapped. */
function harnessFolderFor(provider, model) {
  return HARNESS_MAPPING[`${provider}:${model}`] ?? null;
}