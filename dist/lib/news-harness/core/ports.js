"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NOOP_LOGGER = void 0;
// news-harness — dependency ports.
//
// The harness contains only pure AI-flow logic. Everything RN-coupled (logging
// through Sentry, cloud LLM calls, GraphQL, WatermelonDB persistence, the
// persona store) is injected through the interfaces below so the harness never
// imports lib/logger, lib/config/endpoints, lib/database/*, lib/stores/*, or any
// expo/react-native/watermelondb/zustand module.

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** Default no-op logger — harness functions log nothing unless a real logger is
 *  injected by the app layer. */
const NOOP_LOGGER = exports.NOOP_LOGGER = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// News API
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Persona store
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Suggestion sink
// ---------------------------------------------------------------------------