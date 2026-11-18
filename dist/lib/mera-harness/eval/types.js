"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CARD_ACTION_KINDS = void 0;
// mera-harness/eval — the eval loop's own types and its two ports.
//
// THE WHOLE POINT OF THE PORTS. This module is pure: no network, no fs, no
// clock it does not own. The NEAR caller, the staging rail and the JSONL writer
// live in harness-local and are injected. That is what lets the same eval loop
// run under a CLI, under jest, or against a fake model with zero calls, and it
// is why `runAgentCorpus` can be dry-run to completion for free.

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Injected. The eval never constructs a transport.
 *
 *  ERRORS DIVIDE IN TWO AND THE SPLIT IS LOAD-BEARING. A transport failure is
 *  RETURNED (`result.error` set) and ends the TURN. Anything THROWN is a
 *  run-ending condition the caller raised — the provider's 402 spend limit is
 *  one — and the loop must let it out untouched, or a run records the same
 *  refusal as leg data across every remaining script and reads as the model
 *  failing. Catch what you raise, rethrow what you did not. */

/** Injected. One call per leg, in order. The harness-local adapter enriches
 *  each row with run id, cost and catalogue data before writing JSONL; none of
 *  that belongs in here. */

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * `agent-reply` DELETED. The core never emitted it: reply prose rides the LAST
 * leg, which is a `tool` leg, and that is correct rather than a gap. Keeping a
 * member nothing produces let a rater batch be selected on it and come back
 * empty, which is an empty result wearing the shape of a real one.
 */

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

/** The four action kinds a persona card carries (core/tool-contracts.ts
 *  PROPOSE_CHANGES_TOOL). Re-declared: the eval scores the model's arguments
 *  and must not move when the tool contract's enum does. */
const CARD_ACTION_KINDS = exports.CARD_ACTION_KINDS = ['add_suppression', 'retire_suppression', 'set_publication_pref', 'set_source_scope_pref'];

/** What the follow card shows when the user taps More options. */

// ---------------------------------------------------------------------------
// Topic expectations ('s file)
// ---------------------------------------------------------------------------

/** One fact backing one expectation case. The expectations file selects by
 *  factMatches, so a case with no fact behind it scores nothing at all. */