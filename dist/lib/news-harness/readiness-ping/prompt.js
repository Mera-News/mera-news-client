"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.READINESS_PING_SYSTEM = exports.READINESS_PING_PROMPT = void 0;
// The chat readiness ping: a plain reply, not a tool call.
const READINESS_PING_SYSTEM = exports.READINESS_PING_SYSTEM = 'Reply with the single word "ready" and nothing else.';
const READINESS_PING_PROMPT = exports.READINESS_PING_PROMPT = 'ping';