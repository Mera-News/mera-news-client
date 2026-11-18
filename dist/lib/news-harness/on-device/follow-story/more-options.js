"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MORE_OPTIONS_SYSTEM = void 0;
exports.runMoreTrackOptions = runMoreTrackOptions;
exports.writeMoreTrackOptions = writeMoreTrackOptions;
var _untrustedText = require("../../prompts/untrusted-text");
var _shared = require("../shared");
var _parse = require("./parse");
var _prompt = require("./prompt");
var _schema = require("./schema");
var _slots = require("../../../harnesses/slots");
var _template = require("../../../harnesses/template");
// "More options" on a follow card, on the phone: ONE built-in model call, no
// Kev, no history. RN-free; the app and the harness pass their own writer.

const MORE_OPTIONS_SYSTEM = exports.MORE_OPTIONS_SYSTEM = (0, _template.render)(_slots.DEVICE_SLOTS["follow-story/more-options-system"], {
  IDENTITY_LINE: _shared.IDENTITY_LINE
});
const SCHEMA = {
  type: 'object',
  properties: {
    options: _schema.TRACK_OPTIONS_SCHEMA
  },
  required: ['options']
};
const norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The new options' texts, filtered against the card by label or search and capped at `room`; null when the writer failed. */
async function writeMoreTrackOptions(input, ports) {
  const shownLabels = (0, _untrustedText.asUntrusted)(input.shown.map(s => s.label).join('; '), 400);
  const context = [`Option rules: ${_prompt.TRACK_OPTION_RULES}`, input.articleTitle ? `Article: ${(0, _untrustedText.asUntrusted)(input.articleTitle, 160)}` : `Story: ${shownLabels}`, `Already on the card, write different ones: ${shownLabels}`, `Today: ${input.today}`].join('\n\n');
  let raw;
  try {
    raw = await ports.write(MORE_OPTIONS_SYSTEM, (0, _shared.renderPrompt)(context, [], await ports.budget(MORE_OPTIONS_SYSTEM, SCHEMA)), SCHEMA);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const seenLabels = new Set(input.shown.map(s => norm(s.label)));
  const seenSearches = new Set(input.shown.map(s => norm(s.searchText)));
  const out = [];
  for (const o of (0, _parse.trackOptions)(raw.options)) {
    if (out.length >= input.room) break;
    const label = norm(o.label);
    const search = norm(o.search || o.label);
    if (seenLabels.has(label) || seenSearches.has(search)) continue;
    seenLabels.add(label);
    seenSearches.add(search);
    out.push({
      label: o.label,
      search: o.search || o.label
    });
  }
  return out;
}
async function runMoreTrackOptions(input, ports) {
  const more = await writeMoreTrackOptions(input, ports);
  if (!more) return {
    actions: [],
    reason: 'failed'
  };
  const actions = more.map(o => ({
    type: 'track_story',
    label: o.label,
    searchText: o.search,
    subject: input.subject
  }));
  return actions.length > 0 ? {
    actions
  } : {
    actions: [],
    reason: 'none'
  };
}