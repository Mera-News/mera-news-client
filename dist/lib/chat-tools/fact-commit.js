"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.commitFactChoices = void 0;
var _factService = require("../database/services/fact-service");
var _topicGenerationStatusService = require("../database/services/topic-generation-status-service");
var _factConflict = require("../news-harness/persona-management/fact-conflict");
var _factRules = require("../news-harness/persona-management/fact-rules");
var _geoDerivationService = require("../database/services/geo-derivation-service");
var _floatingChatStore = require("../stores/floating-chat-store");
var _logger = _interopRequireDefault(require("../logger"));
var _toolHandlers = require("./tool-handlers");
var _command = require("../sync/command");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// fact-commit — the WRITE half of propose-then-save.
//
// `handleSaveExtractedFacts` used to do all of this inline, the moment the model
// called the tool. It now only OFFERS readings; nothing here runs until the user
// taps a choice on a FactChoiceCard. The body below is deliberately the old
// handler's body, moved rather than rewritten, so the post-tap behaviour is the
// behaviour that has been in production: same `addFact` call with the same
// questionnaire argument, same conflict detection against the pre-commit bank,
// one `notifyFactMutation`, one `triggerTopicGeneration`, one geo sweep.
//
// ARRAY-SHAPED ON PURPOSE. A single card's tap is just N=1. "Save all" passes
// every chosen group in ONE call, which keeps topic generation to a single
// cloud batch — the same round trip a multi-fact turn used to make — instead of
// one batch per card.

/**
 * Writes the chosen readings and starts everything that used to follow a save.
 *
 * Idempotent by statement: a double tap, or a card resurrected after a failed
 * durable write, returns the existing fact instead of minting a second one.
 */
async function commitFactChoicesLocal(choices, options = {}) {
  const wanted = choices.filter(c => c.statement.trim().length > 0);
  if (wanted.length === 0) return {
    savedFacts: [],
    conflicts: []
  };
  const existingFacts = await (0, _factService.getFacts)();
  const existingByStatement = new Map(existingFacts.map(f => [(0, _factRules.normalizeStatement)(f.statement), f]));
  const excluded = new Set(options.excludeFactIds ?? []);
  const savedFacts = [];
  /** Facts a replacement consumed. They join `excludeFactIds` so a replacement
   *  cannot raise a conflict card against the very row it replaced. */
  const replacedFactIds = [];
  // Enriched with the questionnaire attribute so conflict detection can match on
  // the attribute key (see detectFactConflicts).
  const savedForConflict = [];
  const freshEntries = [];
  for (const choice of wanted) {
    const statement = choice.statement.trim();
    const already = existingByStatement.get((0, _factRules.normalizeStatement)(statement));
    if (already) {
      // Already saved — a double tap, or the same reading arrived twice. Report
      // it so the card can settle, but do not mint a duplicate or re-generate
      // topics for a fact that already has them.
      savedFacts.push({
        id: already.id,
        statement
      });
      continue;
    }
    // `choice.questionnaire` is passed through UNCHANGED. resolveUserLocationFact
    // keys on the attribute, so a residence fact that loses it here stops
    // anchoring every future topic run.
    //
    // `topicsStatus: 'pending'` is set AT COMMIT, before the job is enqueued:
    // addFact otherwise leaves the column NULL, which renders as done, so a
    // saved fact would flash done while its generation run is still ahead of
    // it. This path always enqueues, so it always owns that status.
    const saved = choice.replaces ? await (0, _factService.replaceFact)(choice.replaces, {
      statement,
      questionnaire: choice.questionnaire,
      topicsStatus: 'pending'
    }) : await (0, _factService.addFact)(statement, {
      [_topicGenerationStatusService.TOPICS_FROM_CHAT]: true
    }, choice.questionnaire, {
      topicsStatus: 'pending'
    });
    if (choice.replaces) replacedFactIds.push(choice.replaces);
    savedFacts.push({
      id: saved.id,
      statement
    });
    freshEntries.push({
      id: saved.id,
      statement,
      ...(choice.skillId ? {
        skillId: choice.skillId
      } : {})
    });
    savedForConflict.push({
      id: saved.id,
      statement,
      questionnaireAttribute: choice.questionnaire?.attribute ?? null
    });
  }
  const conflicts = (0, _factConflict.detectFactConflicts)(savedForConflict, existingFacts.filter(f => !excluded.has(f.id) && !replacedFactIds.includes(f.id)).map(f => ({
    id: f.id,
    statement: f.statement,
    questionnaireAttribute: f.questionnaireAttribute ?? null
  })));

  // Once, after every write — avoids the WatermelonDB cache race that per-fact
  // notifications used to cause.
  _floatingChatStore.useFloatingChatStore.getState().notifyFactMutation();
  if (freshEntries.length > 0) {
    (0, _toolHandlers.triggerTopicGeneration)(freshEntries);
    // Derive countries now instead of waiting up to 24h for the `persona-geo`
    // task. `force` bypasses ONLY the cooldown, never the fact-fingerprint, so
    // repeated commits in one session don't each fire a fresh LLM call.
    void (0, _geoDerivationService.runGeoDerivationSweep)({
      force: true
    }).catch(err => _logger.default.warn('[fact-commit] Geo derivation failed', {
      error: String(err)
    }));
  }
  return {
    savedFacts,
    conflicts
  };
}
const commitFactChoices = exports.commitFactChoices = (0, _command.command)('commitFactChoices', commitFactChoicesLocal);