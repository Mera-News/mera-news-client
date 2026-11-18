"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LANES = exports.CHAT_LANES = void 0;
/**
 * The routing lanes. Every model call names one; the router ranks profiles per lane.
 * Kept dependency-free so stores and components can import it without pulling the router.
 */

const LANES = exports.LANES = ['chat-tools', 'chat-single', 'scoring', 'topics', 'background'];

/** The lanes chat-in-cloud lets through while On this phone. */
const CHAT_LANES = exports.CHAT_LANES = ['chat-tools', 'chat-single'];