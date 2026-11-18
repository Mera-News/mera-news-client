"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.HostHarnessError = void 0;
exports.applyHostHarness = applyHostHarness;
Object.defineProperty(exports, "slotText", {
  enumerable: true,
  get: function () {
    return _slotText.slotText;
  }
});
var _index = require("./index");
var _slotText = require("./slot-text");
var _slots = require("./slots.generated");
// A host registers its own harness folder before any prompt module loads: the cloud prompt modules
// read CLOUD_BASE_SLOTS at import, so the host's slot text is folded into it here.

class HostHarnessError extends Error {}
exports.HostHarnessError = HostHarnessError;
const slots = _slots.CLOUD_BASE_SLOTS;

/** The slots nobody includes that sit above `id`, so a host knows what to override instead. */
function topLevelIncluders(id) {
  const tops = new Set();
  const up = at => {
    for (const parent of _slots.CLOUD_BASE_INCLUDED_BY[at] ?? []) if (_slots.CLOUD_BASE_INCLUDED_BY[parent]?.length) up(parent);else tops.add(parent);
  };
  up(id);
  return [...tops].sort();
}

/**
 * Registers the host's folder and folds its chain's slots into the cloud base. Everything is
 * checked before anything is written, so a refused harness leaves the registry as it was.
 */
function applyHostHarness(h) {
  if (h.folder in _index.HARNESS_FILES) throw new HostHarnessError(`harness folder "${h.folder}" already exists`);
  const chain = [h.folder];
  for (let at = h.file.extends; at !== null; at = _index.HARNESS_FILES[at].extends) {
    if (!_index.HARNESS_FILES[at]) throw new HostHarnessError(`harness "${h.folder}": extends "${at}", which does not exist`);
    chain.unshift(at);
  }
  if (chain[0] !== 'cloud-base') throw new HostHarnessError(`harness "${h.folder}": a host harness must extend a cloud harness`);
  const staged = {};
  const read = id => id in staged ? staged[id] : slots[id];
  for (const folder of chain.slice(1)) {
    for (const [id, text] of Object.entries(folder === h.folder ? h.slots : _slots.HARNESS_SLOTS[folder] ?? {})) {
      if (!(id in slots)) throw new HostHarnessError(`harness "${folder}": "${id}" is not a slot of the cloud base`);
      if (_slots.CLOUD_BASE_INCLUDED_BY[id]?.length) throw new HostHarnessError(`harness "${folder}": "${id}" is included by other slots, so overriding it would not reach them; override those slots instead: ${topLevelIncluders(id).join(', ')}`);
      staged[id] = text.replace(_slotText.INCLUDE, (_m, x) => {
        if (!(x in slots)) throw new HostHarnessError(`harness "${folder}": slot "${id}" includes "${x}", which is not a slot of the cloud base`);
        return read(x);
      });
    }
  }
  _index.HARNESS_FILES[h.folder] = h.file;
  Object.assign(_index.HARNESS_MAPPING, h.mapping);
  Object.assign(slots, staged);
  _slots.HARNESS_SLOTS[h.folder] = Object.fromEntries(Object.keys(h.slots).map(id => [id, staged[id]]));
  (0, _index.loadHarness)(h.folder);
}