"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.swipeCallbacks = void 0;
// swipe-callbacks — the mutable callback contract between the Feed deck UI and
// the signal-persistence layer. It ships NO-OP defaults so the deck
// is fully interactive without any persistence; the persistence layer replaces `swipeCallbacks`'s
// members with the real signal writers + Mera invocation.
//
// Kept as a single mutable object (rather than prop-drilling) so the persistence layer can wire the
// persistence layer in one place without touching the deck components. The deck
// imports `swipeCallbacks` and calls its methods; the persistence layer assigns real functions onto
// it (e.g. `Object.assign(swipeCallbacks, realImpl)`), or replaces individual
// members.

/** Live contract object. No-op defaults; the persistence layer fills the members. */
const swipeCallbacks = exports.swipeCallbacks = {
  onVerdict: () => {},
  onInvokeMera: () => {},
  onOpenArticleChat: () => {}
};