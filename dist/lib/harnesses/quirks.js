"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.QUIRKS = void 0;
// Request transforms a model needs and the base harness does not, named in harness.json
// `params.quirks`. The gateway never applies quirks; the OpenAI transport does, and the transport
// sets a private `__enableThinking` on the body for them to read and removes it before sending.

const QUIRKS = exports.QUIRKS = {
  'thinking-off-kwarg': body => ({
    ...body,
    chat_template_kwargs: {
      enable_thinking: body.__enableThinking === true
    }
  }),
  // For endpoints that refuse sampling settings outright (a 400), rather than ignoring them.
  'no-sampling': ({
    temperature: _t,
    top_p: _p,
    ...body
  }) => body
};