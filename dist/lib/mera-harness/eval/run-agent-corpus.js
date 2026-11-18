"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.resultsByIndex = resultsByIndex;
exports.runAgentCorpus = runAgentCorpus;
exports.runAgentScript = runAgentScript;
var _arms = require("../core/arms");
var _core = require("../core/core");
var _skillLoader = require("../core/skill-loader");
var _fakeTools = require("./fake-tools");
// mera-harness/eval — the corpus entry point. Pure: ports in, rows out.
//
//   runAgentCorpus(scripts, { callModel, sink, ... })
//
// No network, no fs, no clock it does not own. The NEAR caller, the staging
// rail and the JSONL writer live in harness-local and are injected, which is
// what lets this same loop run under a CLI, under jest, or against a fake
// model for free.

/** What the loop asked for on each call, captured in request order so it can
 *  be paired with the legs the result hands back. `enableThinking` is not on
 *  AgentLeg, and it is the field that makes an unhonoured switch visible. */

/** `trackedStories.impactQuestion` in en.json: this folder imports no locale. */
const IMPACT_QUESTION = "Before I add it, how does this affect you? Mera's AI uses this to work out how much an article matters to you. " + "If it doesn't affect you personally, I'd recommend just following it as a story.";
const ROLE_TO_CALL_TYPE = {
  route: 'agent-route',
  tool: 'agent-tool',
  // No `reply` entry: the core does not emit that role, and reply prose rides
  // the last tool leg. An unmapped role falls through to 'agent-tool' below,
  // so a future core that DID emit one would be visible as a mapping gap
  // rather than silently creating a category nothing else knows about.
  topicgen: 'agent-topicgen'
};
function parseToolCall(name, argumentsRaw, knownTools, result) {
  let parsed = null;
  try {
    const v = JSON.parse(argumentsRaw);
    if (v && typeof v === 'object' && !Array.isArray(v)) parsed = v;
  } catch {
    parsed = null;
  }
  // Required-property checks, per tool. Split from "did it parse" because a
  // malformed-JSON call and a schema-violating call are different findings and
  // one blurred rate hides both.
  let schemaValid = parsed !== null;
  if (parsed) {
    if (name === 'lookup_place' || name === 'lookupPlace') schemaValid = typeof parsed.query === 'string';else if (name === 'load_skill') schemaValid = typeof parsed.id === 'string';else if (name === 'ask_choice') {
      schemaValid = typeof parsed.question === 'string' && Array.isArray(parsed.options) && parsed.options.length >= 2 && parsed.options.length <= 3;
    } else if (name === 'saveExtractedFacts') {
      schemaValid = Array.isArray(parsed.extracted_user_information);
    } else if (name === 'deleteUserFacts') {
      schemaValid = Array.isArray(parsed.fact_ids);
    } else if (name === 'webSearch') {
      schemaValid = Array.isArray(parsed.queries) && parsed.queries.length >= 1;
    } else if (name === 'proposeChanges') {
      schemaValid = Array.isArray(parsed.actions) && parsed.actions.length >= 1;
    } else if (name === 'explainMera') {
      schemaValid = Array.isArray(parsed.topics) && parsed.topics.length >= 1;
    } else if (name === 'proposeTrack') {
      schemaValid = Array.isArray(parsed.options) && parsed.options.length >= 1;
    } else if (name === 'searchNews') {
      schemaValid = typeof parsed.query === 'string';
    }
  }
  return {
    name,
    argumentsRaw,
    parsed,
    schemaValid,
    unknownTool: !knownTools.has(name),
    result
  };
}

/**
 * Names that are NOT an invented tool. Deliberately wider than what any one
 * leg is offered: it exists only to classify a call as known or invented.
 *
 * DO NOT report this as the tool list the model saw. It is not. The row's
 * `toolSchemaNames` now carries what the leg was ACTUALLY sent, because this
 * constant said `saveExtractedFacts` was available on every row while the
 * loop was never offering it, which is exactly the fact the rows were needed
 * to establish.
 */
const KNOWN_TOOLS = new Set(['load_skill', 'find_similar_facts', 'findSimilarFacts', 'lookup_place', 'lookupPlace', 'ask_choice', 'saveExtractedFacts', 'deleteUserFacts', 'webSearch', 'explainMera', 'proposeChanges', 'applyProposal', 'cancelProposal', 'proposeTrack', 'searchNews',
// Loop-written, never the model's: the "Save as I wrote it" chip.
'saveAsWritten']);

/** The tool names a request actually carried, read off the request itself. */
function sentToolNames(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map(t => t?.function?.name).filter(n => typeof n === 'string');
}

/**
 * Why this does NOT read `state.turn.pendingChoice`.
 *
 * pendingChoice PERSISTS across turns: the core clears it only when the next
 * user message matches an offered option, so an unanswered question leaves it
 * set forever and every later turn reports `awaiting_user`. Measured on the
 * live run: 54 turns actually called ask_choice, and the consecutive-question
 * metric reported 100 offending pairs out of 312 turns, which is more pairs
 * than 54 asking turns can produce. That was the metric reading stale state,
 * not the agent interrogating anyone.
 *
 * So the verdict comes from what THIS turn did: did one of its own legs call
 * ask_choice.
 */
function endedOnFor(askedThisTurn, legBudgetHit, lastError, terminalReason) {
  if (lastError) return 'transport_error';
  if (askedThisTurn) return 'awaiting_user';
  // `legBudgetHit` ALONE over-reported this by an order of magnitude: in an evaluation run, 16
  // of 18 turns it called capped had already proposed a fact, so the rate read
  // 23% when the real failures were about 2 in 18. The loop now distinguishes
  // the two, and the verdict follows the loop rather than the raw budget flag.
  if (legBudgetHit && terminalReason === 'leg-cap') return 'leg_cap';
  // BEFORE the settled default, never after: a turn that routed nothing is the
  // failure this run exists to measure, and folding it into `settled` is what
  // made it invisible for three runs.
  if (terminalReason === 'no-route') return 'no_route';
  return 'settled';
}

/**
 * Each call's result, paired BY INDEX within the leg. The loop pushes one result
 * per call in call order, so the Nth result answers the Nth call. Pairing by NAME
 * (the old Map) gave two calls to the same tool in one leg the LAST result.
 *
 * The name is checked, not trusted: a call the loop dropped without a result
 * would shift every later pair. On a mismatch the call takes the first unused
 * result of its own name, and null when there is none.
 */
function resultsByIndex(calls, results) {
  const used = new Set();
  return calls.map((c, i) => {
    let at = results[i]?.name === c.name && !used.has(i) ? i : -1;
    if (at < 0) at = results.findIndex((r, j) => r.name === c.name && !used.has(j));
    if (at < 0) return null;
    used.add(at);
    return results[at].result;
  });
}
function personaFor(script) {
  return {
    facts: script.persona.facts.map(f => ({
      id: f.id,
      statement: f.statement,
      attribute: f.questionnaireAttribute
    })),
    surface: 'CONFIG',
    languageName: script.persona.languageName
  };
}

/**
 * Drives one script to completion and emits one row per model leg.
 *
 * ERRORS DIVIDE IN TWO AND BOTH HALVES MATTER. A transport failure is returned
 * by the caller, ends the TURN, and is recorded. Anything THROWN is a
 * run-ending condition the caller raised (the provider's 402 is one) and is
 * let straight out: recording those as leg data writes a file of empty rows
 * across every remaining script that reads as the model failing.
 */
async function runAgentScript(script, opts) {
  const now = opts.now ?? (() => Date.now());
  const skillIds = opts.skillIds ?? [];
  const fakes = (0, _fakeTools.createFakeTools)(script);
  const state = (0, _core.createAgentState)(personaFor(script));
  state.surfaceContext = script.surface ?? null;
  for (const turn of script.turns) {
    const isMoreOptions = turn.moreOptions !== undefined;
    const userMessage = isMoreOptions ? '' : resolveUserMessage(turn, state.turn, script, opts);
    fakes.beginTurn(turn, state.turn);
    // The card slot and the filters live in the fake across turns, like the
    // device's screen: a card staged on turn N is still waiting on turn N+1.
    state.pendingProposal = fakes.pendingProposal();
    state.activeFilters = fakes.activeFilters();
    // Fact cards the fixture says are waiting, this turn only.
    state.pendingCardStatements = turn.pendingCards ?? [];
    if (turn.impactTap) (0, _core.withImpactQuestion)(state.turn, IMPACT_QUESTION);
    const turnStartedAtMs = now();
    const captured = [];
    const callModel = async req => {
      captured.push({
        role: req.role,
        enableThinking: req.enableThinking ?? null,
        startedAtMs: now(),
        toolNames: sentToolNames(req.tools)
      });
      // Forwarded, never swallowed: an ignored onDelta means the core runs a
      // different path here than in the app, which is the one thing a
      // measurement harness must not do.
      return opts.callModel({
        ...req,
        onDelta: req.onDelta
      });
    };
    const deps = {
      callModel,
      tools: {
        ...fakes.port,
        ...(opts.explainMera ? {
          explainMera: opts.explainMera
        } : {}),
        ...(script.webSearchOff ? {
          webSearch: undefined
        } : {})
      },
      loadSkill: opts.loadSkill ?? _skillLoader.loadSkill,
      skillIds: () => skillIds,
      now
    };

    // THE ONE-SHOT PERSONA CONTROL IS NOT IMPLEMENTED HERE, so an arm asking
    // for it must stop the run rather than quietly receive the router. That is
    // exactly what happened: `oneshot-prod` ran the router loop for three full
    // corpus runs and was written up as the production control.
    // `personaPromptFor` had no caller at all outside its own unit test.
    if ((0, _arms.personaPromptFor)((0, _arms.resolveAgentArm)(opts.promptVariant ?? opts.variant)) === 'oneshot') {
      throw new Error(`mera-harness/eval: arm '${opts.promptVariant}' asks for the one-shot persona prompt, ` + 'which this runner cannot build (it lives in news-harness and this folder imports ' + 'nothing from there). Running it as the router would measure the control twice.');
    }

    // A More options tap is not a conversation turn: it runs on a COPY, so the
    // script's state (and the next turn) never sees it. The fake card slot is the
    // one thing it shares, so a script mixes it with other turns at its own risk.
    const turnState = isMoreOptions ? structuredClone(state) : state;
    const result = await (0, _core.runAgentTurn)({
      state: turnState,
      userMessage,
      deps,
      maxLegs: opts.maxLegs,
      promptVariant: opts.promptVariant ?? opts.variant,
      model: opts.model,
      ...(isMoreOptions ? {
        mode: 'moreOptions',
        moreOptions: turn.moreOptions
      } : {})
    });
    const lastError = result.legs.length > 0 ? result.legs[result.legs.length - 1].result.error : null;
    const askedThisTurn = result.legs.some(l => l.toolCalls.some(t => t.name === 'ask_choice'));
    const endedOn = endedOnFor(askedThisTurn, result.legBudgetHit, lastError, result.terminalReason);
    result.legs.forEach((leg, i) => {
      const cap = captured[i];
      const isLast = i === result.legs.length - 1;
      const resultFor = resultsByIndex(leg.toolCalls, leg.toolResults);
      opts.sink({
        scriptId: script.id,
        cohort: script.cohort,
        turnIndex: turn.index,
        legIndex: leg.index,
        repeat: opts.repeat,
        arm: opts.arm,
        variant: opts.variant,
        ...(isMoreOptions ? {
          moreOptions: true
        } : {}),
        callType: ROLE_TO_CALL_TYPE[leg.role] ?? 'agent-tool',
        // THE TURN, never the leg. Leg counts are ragged across repeats and
        // the one-shot control arm has no leg above 0, so a leg-level group
        // would mark every high leg non-interleaved and empty the latency
        // columns.
        interleaveGroup: `${script.id}:${turn.index}`,
        promptDeterministic: turn.index === 0 && leg.index === 0,
        systemPrompt: leg.systemPrompt,
        messages: leg.messages,
        toolSchemaNames: cap?.toolNames ?? [],
        rawOutput: leg.rawOutput,
        toolCalls: leg.toolCalls.map((t, ti) => parseToolCall(t.name, t.argumentsRaw, KNOWN_TOOLS, resultFor[ti])),
        turnStartedAtMs,
        legStartedAtMs: cap?.startedAtMs ?? turnStartedAtMs,
        latencyMs: leg.result.latencyMs,
        ttVisibleMs: leg.result.ttVisibleMs ?? null,
        thinkingRequested: cap?.enableThinking ?? null,
        inputTokens: leg.inputTokens,
        usage: leg.result.usage,
        finishReason: leg.result.finishReason,
        truncated: leg.result.truncated,
        error: leg.result.error,
        modelRequested: opts.model,
        modelSent: leg.result.modelSent,
        endedOn: isLast ? endedOn : null,
        formatRetries: isLast ? result.formatRetries : null,
        // Per TURN, on its last row: the gate acts once, at the settle decision.
        replyRetries: isLast ? result.replyRetries : null,
        replyClaimUnfixed: isLast ? result.replyClaimUnfixed : null,
        replyLeakUnfixed: isLast ? result.replyLeakUnfixed : null,
        reply: isLast ? result.reply : null,
        terminalReason: isLast ? result.terminalReason : null,
        closingLegFired: isLast ? result.closingLegFired : null,
        noAnswerFallbackUsed: isLast ? result.noAnswerFallbackUsed : null,
        closingClaim: isLast ? result.closingClaim : null,
        stagedSomething: isLast ? result.stagedSomething : null,
        choicePending: isLast ? turnState.turn.pendingChoice !== null : null,
        awaitingUser: isLast && endedOn === 'awaiting_user',
        routeKind: result.routeKind,
        skillLoaded: result.skillLoaded,
        expectedRouteKind: turn.expect.routeKind ?? null,
        expectedSkill: turn.expect.skill ?? null,
        items: null,
        factKind: null,
        topics: null,
        dropped: null
      });
    });
  }
}

/**
 * The message this turn sends.
 *
 * A choice reply sends the FIXTURE's text, always. If the arm offered options
 * that do not contain it, that is recorded and the fixture still wins — see
 * onChoiceOptionMismatch.
 */
function resolveUserMessage(turn, turnState, script, opts) {
  if (turn.chooses === undefined) return turn.user ?? '';
  const offered = turnState.pendingChoice?.options.map(o => o.text) ?? [];
  if (!offered.some(o => o.trim().toLowerCase() === turn.chooses.trim().toLowerCase())) {
    opts.onChoiceOptionMismatch?.({
      scriptId: script.id,
      turnIndex: turn.index,
      expected: turn.chooses,
      offered
    });
  }
  return turn.chooses;
}
async function runAgentCorpus(scripts, opts) {
  for (const script of scripts) await runAgentScript(script, opts);
}