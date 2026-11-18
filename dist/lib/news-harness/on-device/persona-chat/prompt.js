"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.buildPersonaChatPrompt = buildPersonaChatPrompt;
exports.personaChatContext = personaChatContext;
exports.personaChatInstructions = personaChatInstructions;
exports.shownFactIds = shownFactIds;
var _personaPrompts = require("../../prompts/persona-prompts");
var _untrustedText = require("../../prompts/untrusted-text");
var _shared = require("../shared");
var _slots = require("../../../harnesses/slots");
var _template = require("../../../harnesses/template");
/** Newest facts shown; older ones fall out of the context first. */
const MAX_FACTS = 20;
function personaChatInstructions(surface, languageName) {
  const onboarding = surface === 'ONBOARDING';
  const isConfig = surface === 'CONFIG';
  const language = (0, _shared.languageLine)(languageName);
  return (0, _template.render)(_slots.DEVICE_SLOTS["persona-chat/instructions"], {
    IDENTITY_LINE: _shared.IDENTITY_LINE,
    isConfig,
    language,
    onboarding
  });
}
function personaChatContext(surface, c) {
  const facts = c.facts.slice(0, MAX_FACTS);
  const blocks = [`Known facts:\n${facts.length > 0 ? facts.map(f => `- [${f.id}] ${(0, _untrustedText.asUntrusted)(f.statement, 160)}${f.attribute ? ` (${(0, _untrustedText.asUntrusted)(f.attribute, 40)})` : ''}`).join('\n') : 'None yet.'}`];
  if (c.topicPlanNotes) {
    blocks.push(`Topic plan decisions, already applied, so do not repeat or undo them:\n${c.topicPlanNotes}`);
  }
  if (surface === 'ONBOARDING') {
    blocks.push(`Questions you can ask, skipping any Known facts already answer:\n${_personaPrompts.DEEP_EXAMPLE_QUESTIONS.map(q => `- ${q}`).join('\n')}`);
  }
  if (c.pending) blocks.push(c.pending);
  return blocks.join('\n\n');
}

/** The ids the context shows, so a delete can be checked against them. */
function shownFactIds(c) {
  return new Set(c.facts.slice(0, MAX_FACTS).map(f => f.id));
}
function buildPersonaChatPrompt(surface, context, history, budgetTokens) {
  return (0, _shared.renderPrompt)(personaChatContext(surface, context), history, budgetTokens);
}