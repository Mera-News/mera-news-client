"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ON_DEVICE_HARNESS = exports.DEVICE_SLOTS = void 0;
exports.resolveSlots = resolveSlots;
var _index = require("./index");
var _slots = require("./slots.generated");
// A harness's prompt slots: the .md files of its folder overlaid on its base's, compiled by
// `npm run harness:generate` into slots.generated.ts (Metro cannot read a directory or a .md at
// runtime). The on-device prompt modules read DEVICE_SLOTS, so an override in afm/ reaches every
// on-device request; the cloud prompt modules still read cloud-base directly.

/** Every slot the harness in `folder` sees, its base's first and each override after. */
function resolveSlots(folder) {
  return Object.assign({}, ...(0, _index.loadHarness)(folder).chain.map(f => _slots.HARNESS_SLOTS[f] ?? {}));
}

/**
 * The harness every on-device prompt is read from. shortcut: one folder for every built-in
 * model, because only Apple's is linked; pick per TextEngine once Gemini Nano links.
 */
const ON_DEVICE_HARNESS = exports.ON_DEVICE_HARNESS = 'afm';

/** The on-device slots as the built-in model receives them: device-base plus afm's overrides. */
const DEVICE_SLOTS = exports.DEVICE_SLOTS = resolveSlots(ON_DEVICE_HARNESS);