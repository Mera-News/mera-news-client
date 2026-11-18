"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createAgentTurnState = createAgentTurnState;
// mera-harness/core — shared types. PURE: no imports at all, by design.
//
// Everything the harness exposes to the app and to the eval runner is declared
// here. Nothing in this folder may import react, react-native, expo,
// @/lib/database, @/lib/stores, @/lib/hooks, @/components or harness-local;
// __tests__/boundary.test.ts enforces that for the whole folder.

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/**
 * The closed bloc vocabulary, and the TOP RUNG of a place chain as-is: the
 * residence skill does not translate or re-map it.
 *
 * DECLARED HERE, not in place-service, and the direction matters. The harness
 * must not import place-service (Apollo, RN), so a type owned there could never
 * be referenced from inside this folder. place-service imports `Bloc` from
 * '@/lib/mera-harness' and owns the countryCode -> Bloc map; nothing inside the
 * harness imports place-service. One declaration, one map, and the dependency
 * points the only way the boundary allows.
 */

// ---------------------------------------------------------------------------
// Tool results
// ---------------------------------------------------------------------------

/**
 * The place a saved fact carries, as copied back by the model and reconciled
 * against the candidates the port actually returned.
 *
 * An ALIAS of Place, deliberately, rather than a second shape: the chain the
 * model hands back must be one of the candidates it was given, so a distinct
 * type would only invite the two to drift.
 */

/** NO statement and NO query: tool arguments sit outside the E2EE envelope and
 *  the device already holds the user's raw message. */

// ---------------------------------------------------------------------------
// Turn state
// ---------------------------------------------------------------------------

/** One object per option — never parallel arrays of text and payload. */

function createAgentTurnState() {
  return {
    pendingChoice: null,
    resolvedChoice: null,
    turnActive: false,
    lastTurnAskedQuestion: false,
    lastQuestion: null,
    lastRoute: null,
    lastSkill: null,
    lastUserMessage: null,
    lastReply: null,
    confirmedPlace: null,
    offeredStatements: [],
    turnNumber: 0,
    choiceTurn: null,
    lastCard: null,
    recentExchanges: [],
    lastSubjects: []
  };
}

/**
 * The card waiting for the user's tap or agreement, as the driver sees it
 * before a turn. `summary` is device-written text describing the card.
 */

/** Where the chat was opened and what the user probably wants there. Rendered
 *  verbatim as `<surface>`: the driver escapes every dynamic field. */

// ---------------------------------------------------------------------------
// Model + tool ports
// ---------------------------------------------------------------------------

/** Every device-backed tool, as a port. The eval supplies fakes. */

// ---------------------------------------------------------------------------
// Legs and turn result
// ---------------------------------------------------------------------------