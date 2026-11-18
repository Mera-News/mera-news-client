"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MAX_TITLE_CHARS = exports.MAX_TITLES = exports.MAX_HEADLINE_WORDS = void 0;
// news-harness — story-headline tuning constants (PURE, RN-free).
//
// Shares the same 4096-ctx / 1024-out budget as every other on-device flow, so
// the input side must stay well under ~3072 tokens. We cap the number of titles
// fed in and truncate each so even a large story fits comfortably.

/** Max article titles fed to the headline prompt. */
const MAX_TITLES = exports.MAX_TITLES = 12;

/** Each title is truncated to this many chars in the prompt. */
const MAX_TITLE_CHARS = exports.MAX_TITLE_CHARS = 140;

/** Target ceiling on the generated headline length (prompt guidance). */
const MAX_HEADLINE_WORDS = exports.MAX_HEADLINE_WORDS = 10;