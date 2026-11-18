"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SUBSCRIPTION_READ_SYSTEM = void 0;
exports.buildSubscriptionReadPrompt = buildSubscriptionReadPrompt;
var _untrustedText = require("../../prompts/untrusted-text");
var _slots = require("../../../harnesses/slots");
// On-device subscription read: how a publication the reader pays for covered a
// story, from its headline and description only (the body is paywalled and
// never fetched). Plain text, or a bare SKIP.

const SUBSCRIPTION_READ_SYSTEM = exports.SUBSCRIPTION_READ_SYSTEM = _slots.DEVICE_SLOTS["subscription-read/subscription-read-system"];
function buildSubscriptionReadPrompt(input) {
  const field = (label, value) => value ? [`${label}: ${(0, _untrustedText.asUntrusted)(value)}`] : [];
  const lines = [`The reader is looking at this story: ${input.anchorTitle ? (0, _untrustedText.asUntrusted)(input.anchorTitle) : '(untitled)'}`, '', ...field('Their subscribed outlet', input.publicationName), ...field('Its headline', input.title), ...field('Its description', input.description), ...field('Category', input.category), ...field('Event type', input.eventType)];
  return {
    system: SUBSCRIPTION_READ_SYSTEM,
    prompt: lines.join('\n')
  };
}