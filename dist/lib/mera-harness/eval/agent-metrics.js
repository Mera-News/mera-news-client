"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FIRST_PROSE_P95_MULTIPLE = exports.FIRST_PROSE_P50_MULTIPLE = void 0;
exports.cardReport = cardReport;
exports.cardTurn = cardTurn;
exports.consecutiveQuestionReport = consecutiveQuestionReport;
exports.firstProseGate = firstProseGate;
exports.firstProseReport = firstProseReport;
exports.groupTurns = groupTurns;
exports.inputTokenReport = inputTokenReport;
exports.legReport = legReport;
exports.offerGuardReport = offerGuardReport;
exports.percentile = percentile;
exports.proposalReport = proposalReport;
exports.proseReport = proseReport;
exports.replyCheckReport = replyCheckReport;
exports.routeOutcomes = routeOutcomes;
exports.routerReport = routerReport;
exports.silentTurnReport = silentTurnReport;
exports.skillOutcomes = skillOutcomes;
exports.skillReport = skillReport;
exports.thinkingGearReport = thinkingGearReport;
exports.toolValidityReport = toolValidityReport;
var _prose = require("../core/prose");
var _copyRules = require("./copy-rules");
// mera-harness/eval — per-turn and per-leg metrics over collected rows. Pure.
//
// READING ORDER IS PART OF THE RESULT. Damage before quality, quality before
// cost. Every block below states what it must NOT be read as, because most of
// these numbers have a way of looking good for the wrong reason.

// ---------------------------------------------------------------------------
// Turn assembly
// ---------------------------------------------------------------------------

function groupTurns(rows) {
  const byTurn = new Map();
  for (const r of rows) {
    const key = `${r.arm}|${r.scriptId}|${r.repeat}|${r.turnIndex}`;
    let t = byTurn.get(key);
    if (!t) {
      t = {
        scriptId: r.scriptId,
        cohort: r.cohort,
        turnIndex: r.turnIndex,
        repeat: r.repeat,
        arm: r.arm,
        legs: [],
        topicRows: [],
        endedOn: null
      };
      byTurn.set(key, t);
    }
    if (r.callType === 'agent-topicgen') t.topicRows.push(r);else t.legs.push(r);
    if (r.endedOn) t.endedOn = r.endedOn;
  }
  for (const t of byTurn.values()) t.legs.sort((a, b) => a.legIndex - b.legIndex);
  return [...byTurn.values()];
}

// ---------------------------------------------------------------------------
// Router and skill: TWO ALPHABETS, never pooled
// ---------------------------------------------------------------------------

/** One outcome per TURN, read off its last leg. A turn is the unit that has a
 *  route, not a leg, and every leg repeats the value. */
function routeOutcomes(turns) {
  const out = [];
  for (const t of turns) {
    const last = t.legs[t.legs.length - 1];
    if (!last || last.expectedRouteKind === null) continue;
    const actual = last.routeKind;
    out.push({
      cohort: t.cohort,
      scriptId: t.scriptId,
      turnIndex: t.turnIndex,
      expected: last.expectedRouteKind,
      // The core returns null for "no kind"; a fixture spells that `none`.
      actual: actual ?? 'none',
      correct: (actual ?? 'none') === last.expectedRouteKind
    });
  }
  return out;
}

/** One skill outcome per turn, likewise off its last leg. */
function skillOutcomes(turns) {
  const out = [];
  for (const t of turns) {
    const last = t.legs[t.legs.length - 1];
    if (!last || last.expectedSkill === null) continue;
    out.push({
      expectedSkill: last.expectedSkill,
      loaded: last.skillLoaded,
      routeCorrect: (last.routeKind ?? 'none') === last.expectedRouteKind
    });
  }
  return out;
}
function routerReport(outcomes) {
  const byCohort = {};
  const confusion = {};
  let unparsed = 0;
  for (const o of outcomes) {
    const c = byCohort[o.cohort] ??= {
      n: 0,
      correct: 0
    };
    c.n += 1;
    if (o.correct) c.correct += 1;
    if (o.actual === null) unparsed += 1;
    const row = confusion[o.expected] ??= {};
    const key = o.actual ?? '(unparsed)';
    row[key] = (row[key] ?? 0) + 1;
  }
  return {
    byCohort,
    confusion,
    unparsed
  };
}
function skillReport(rows, knownSkillIds) {
  const known = new Set(knownSkillIds);
  const outcomes = {
    correct: 0,
    'wrong-id': 0,
    'none-loaded': 0,
    'nonexistent-id': 0
  };
  let routeCorrectSkillWrong = 0;
  for (const r of rows) {
    let o;
    if (r.loaded === null) o = 'none-loaded';else if (r.loaded === r.expectedSkill) o = 'correct';else if (!known.has(r.loaded)) o = 'nonexistent-id';else o = 'wrong-id';
    outcomes[o] += 1;
    if (o !== 'correct' && r.routeCorrect) routeCorrectSkillWrong += 1;
  }
  return {
    outcomes,
    routeCorrectSkillWrong,
    distinctSkillIds: known.size
  };
}

// ---------------------------------------------------------------------------
// Tool validity
// ---------------------------------------------------------------------------

function toolValidityReport(rows) {
  const byTool = {};
  let unknownToolCalls = 0;
  for (const r of rows) {
    for (const t of r.toolCalls) {
      const e = byTool[t.name] ??= {
        calls: 0,
        unparseable: 0,
        schemaInvalid: 0
      };
      e.calls += 1;
      if (t.parsed === null) e.unparseable += 1;else if (!t.schemaValid) e.schemaInvalid += 1;
      if (t.unknownTool) unknownToolCalls += 1;
    }
  }
  return {
    byTool,
    unknownToolCalls
  };
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

function legReport(turns, expectFor) {
  const histogram = {};
  const cappedBelowExpectation = [];
  const legCountMismatches = [];
  let endedOnTransportError = 0;
  for (const t of turns) {
    const n = t.legs.length;
    histogram[n] = (histogram[n] ?? 0) + 1;
    if (t.endedOn === 'transport_error') {
      endedOnTransportError += 1;
      // Ending early here is right, so it is not a mismatch.
      continue;
    }
    const expect = expectFor(t.scriptId, t.turnIndex);
    if (!expect || expect.legs === undefined) continue;
    if (t.endedOn === 'leg_cap' && expect.legs < 4) {
      cappedBelowExpectation.push({
        scriptId: t.scriptId,
        turnIndex: t.turnIndex,
        expected: expect.legs,
        actual: n
      });
    }
    if (n !== expect.legs) {
      legCountMismatches.push({
        scriptId: t.scriptId,
        turnIndex: t.turnIndex,
        expected: expect.legs,
        actual: n
      });
    }
  }
  return {
    histogram,
    cappedBelowExpectation,
    endedOnTransportError,
    legCountMismatches
  };
}

// ---------------------------------------------------------------------------
// Proposal expectations
// ---------------------------------------------------------------------------

/**
 * Reads the statements the fake save ACCEPTED, i.e. after the loop sanitised
 * them (an invented rung removed, the user's term put first), never the
 * model's raw arguments: the card shows the sanitised form. Until this existed
 * no metric read `expect.proposals`, so every fixture's proposal expectation
 * was inert.
 */
function proposalReport(turns, expectFor) {
  let expected = 0;
  let met = 0;
  const misses = [];
  for (const t of turns) {
    const wanted = expectFor(t.scriptId, t.turnIndex)?.proposals ?? [];
    if (wanted.length === 0) continue;
    const offered = t.legs.flatMap(l => l.toolCalls.filter(c => c.name === 'saveExtractedFacts').flatMap(c => {
      const r = c.result;
      return Array.isArray(r?.accepted) ? r.accepted.filter(x => typeof x === 'string') : [];
    }));
    for (const w of wanted) {
      expected += 1;
      const hit = offered.some(s => {
        const lower = s.toLowerCase();
        return w.statementMatches.every(m => lower.includes(m)) && !(w.statementExcludes ?? []).some(x => lower.includes(x));
      });
      if (hit) met += 1;else misses.push({
        scriptId: t.scriptId,
        turnIndex: t.turnIndex,
        repeat: t.repeat,
        wanted: w.statementMatches,
        offered
      });
    }
  }
  return {
    expected,
    met,
    misses
  };
}

/**
 * OFFER GUARDS: a turn that must offer nothing (`noOffer`) or nothing naming an
 * earlier subject (`offerExcludes`, the leak guard). Over the statements the
 * fake save ACCEPTED, like `proposalReport`.
 */

function offerGuardReport(turns, expectFor) {
  let checked = 0;
  let passed = 0;
  const misses = [];
  for (const t of turns) {
    const ex = expectFor(t.scriptId, t.turnIndex);
    if (!ex || !ex.noOffer && !(ex.offerExcludes ?? []).length) continue;
    checked += 1;
    const offered = t.legs.flatMap(l => l.toolCalls.filter(c => c.name === 'saveExtractedFacts').flatMap(c => {
      const r = c.result;
      return Array.isArray(r?.accepted) ? r.accepted.filter(x => typeof x === 'string') : [];
    }));
    const leaked = offered.some(s => (ex.offerExcludes ?? []).some(x => s.toLowerCase().includes(x)));
    if (ex.noOffer && offered.length > 0 || leaked) {
      misses.push({
        scriptId: t.scriptId,
        turnIndex: t.turnIndex,
        repeat: t.repeat,
        offered
      });
    } else {
      passed += 1;
    }
  }
  return {
    checked,
    passed,
    misses
  };
}

// ---------------------------------------------------------------------------
// Time to first prose
// ---------------------------------------------------------------------------

/**
 * Spans legs on purpose.
 *
 * Per-leg ttVisibleMs CANNOT express this. The routing leg emits no prose, so
 * it is excluded from that statistic entirely, and an agent that spends a whole
 * extra leg before the first token shows an UNCHANGED per-leg figure while the
 * user's wait has doubled. Reading the per-leg column alone would report "no
 * latency regression" on exactly the regression this measures.
 */
function firstProseReport(turns) {
  const byArm = {};
  let turnsWithoutProse = 0;
  for (const t of turns) {
    const first = t.legs.find(l => l.ttVisibleMs !== null);
    if (!first || first.ttVisibleMs === null) {
      turnsWithoutProse += 1;
      continue;
    }
    const ms = first.legStartedAtMs + first.ttVisibleMs - first.turnStartedAtMs;
    (byArm[t.arm] ??= []).push(ms);
  }
  return {
    byArm,
    turnsWithoutProse
  };
}
function percentile(values, q) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
}
const FIRST_PROSE_P50_MULTIPLE = exports.FIRST_PROSE_P50_MULTIPLE = 1.5;
const FIRST_PROSE_P95_MULTIPLE = exports.FIRST_PROSE_P95_MULTIPLE = 2.0;
function firstProseGate(arm, control) {
  const armP50 = percentile(arm, 0.5);
  const armP95 = percentile(arm, 0.95);
  const controlP50 = percentile(control, 0.5);
  const controlP95 = percentile(control, 0.95);
  const passed = armP50 !== null && controlP50 !== null && armP95 !== null && controlP95 !== null ? armP50 <= controlP50 * FIRST_PROSE_P50_MULTIPLE && armP95 <= controlP95 * FIRST_PROSE_P95_MULTIPLE : false;
  return {
    armP50,
    armP95,
    controlP50,
    controlP95,
    passed,
    biasNote: 'FLOOR, not the user number: fake tools answer instantly. The agent arms make more tool ' + 'calls than the one-shot control, so this ratio understates the agent. Only a device ' + 'capture settles it.'
  };
}

// ---------------------------------------------------------------------------
// Consecutive questions
// ---------------------------------------------------------------------------

function consecutiveQuestionReport(turns) {
  const pairs = [];
  const key = t => `${t.arm}|${t.scriptId}|${t.repeat}`;
  const groups = new Map();
  for (const t of turns) {
    const g = groups.get(key(t)) ?? [];
    g.push(t);
    groups.set(key(t), g);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => a.turnIndex - b.turnIndex);
    for (let i = 1; i < g.length; i++) {
      if (g[i - 1].endedOn === 'awaiting_user' && g[i].endedOn === 'awaiting_user') {
        pairs.push({
          arm: g[i].arm,
          scriptId: g[i].scriptId,
          firstTurn: g[i - 1].turnIndex,
          secondTurn: g[i].turnIndex
        });
      }
    }
  }
  return {
    pairs,
    passed: pairs.length === 0
  };
}

// ---------------------------------------------------------------------------
// Input tokens and the thinking gear
// ---------------------------------------------------------------------------

function inputTokenReport(turns) {
  const perLeg = {};
  const perTurn = {};
  const cachedPerTurn = {};
  for (const t of turns) {
    let total = 0;
    let cached = 0;
    for (const l of [...t.legs, ...t.topicRows]) {
      // REAL first, estimate second. AgentLeg.inputTokens is a char-based
      // estimate; usage.promptTokens is what the provider billed. Preferring
      // the estimate produced a per-turn total of 918 against a CACHED figure
      // of 2624 from the same rows - a total smaller than its own subset,
      // which is incoherent on its face and was reported anyway.
      const n = l.usage?.promptTokens ?? l.inputTokens ?? 0;
      (perLeg[t.arm] ??= []).push(n);
      total += n;
      cached += l.usage?.cachedTokens ?? 0;
    }
    (perTurn[t.arm] ??= []).push(total);
    (cachedPerTurn[t.arm] ??= []).push(cached);
  }
  return {
    perLeg,
    perTurn,
    cachedPerTurn
  };
}
function thinkingGearReport(rows) {
  let requestedOff = 0;
  let requestedOn = 0;
  let requestedOffButReasoned = 0;
  for (const r of rows) {
    if (r.thinkingRequested === false) {
      requestedOff += 1;
      if ((r.usage?.reasoningTokens ?? 0) > 0) requestedOffButReasoned += 1;
    } else if (r.thinkingRequested === true) {
      requestedOn += 1;
    }
  }
  return {
    requestedOff,
    requestedOn,
    requestedOffButReasoned
  };
}

// ---------------------------------------------------------------------------
// Reply prose
// ---------------------------------------------------------------------------

function proseReport(rows) {
  let rowsWithProse = 0;
  let bannedDash = 0;
  for (const r of rows) {
    const text = (0, _copyRules.proseOf)(r.rawOutput);
    if (text.length === 0) continue;
    rowsWithProse += 1;
    if ((0, _copyRules.hasBannedDash)(text)) bannedDash += 1;
  }
  return {
    rowsWithProse,
    bannedDash
  };
}

// ---------------------------------------------------------------------------
// Silent turns: no reply, nothing on screen, no ending sentence
// ---------------------------------------------------------------------------

/** Terminals the thread renders as a sentence of their own. */
const RENDERED_TERMINALS = new Set(['leg-cap', 'no-proposal', 'unknown-tool', 'malformed-choice', 'no-route']);
/** Read from the turn's last row; rows written before these fields existed are skipped. */
function silentTurnReport(turns) {
  const out = {
    turns: 0,
    silent: [],
    closingFired: 0,
    cannedFired: 0,
    closingClaims: 0
  };
  for (const t of turns) {
    const last = t.legs[t.legs.length - 1];
    if (!last || last.terminalReason == null) continue;
    // A More options turn writes nothing to the thread by design; MORE OPTIONS scores it.
    if (t.legs.some(l => l.moreOptions)) continue;
    out.turns += 1;
    if (last.closingLegFired) out.closingFired += 1;
    if (last.noAnswerFallbackUsed) out.cannedFired += 1;
    if (last.closingClaim) out.closingClaims += 1;
    const errored = last.terminalReason === 'transport-error' || t.legs.some(l => l.error !== null);
    if (!errored && !(last.reply ?? '').trim() && !last.stagedSomething && !last.choicePending && !RENDERED_TERMINALS.has(last.terminalReason)) {
      out.silent.push({
        scriptId: t.scriptId,
        turnIndex: t.turnIndex,
        repeat: t.repeat,
        arm: t.arm
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reply checks (replyScript / replyExcludes / replyMatches)
// ---------------------------------------------------------------------------

const emptyTally = () => ({
  checked: 0,
  passed: 0,
  noReply: 0,
  errored: 0,
  misses: []
});

/**
 * Scores the turn's FINAL reply, `reply` on its last row: what the bubble
 * shows. Never a leg's rawOutput, which a later leg overwrites.
 */
function replyCheckReport(turns, expectFor) {
  const out = {
    script: emptyTally(),
    excludes: emptyTally(),
    matches: emptyTally()
  };
  for (const t of turns) {
    const ex = expectFor(t.scriptId, t.turnIndex);
    if (!ex) continue;
    const errored = t.endedOn === 'transport_error' || t.legs.some(l => l.error !== null);
    const last = t.legs[t.legs.length - 1];
    const reply = (last?.reply ?? '').trim();
    const lower = reply.toLowerCase();
    const checks = [['script', ex.replyScript !== undefined, () => {
      const share = (0, _copyRules.scriptShare)(reply, ex.replyScript);
      return share !== null && share >= _copyRules.REPLY_SCRIPT_MIN_SHARE ? null : `share ${share === null ? 'none' : share.toFixed(2)}`;
    }], ['excludes', ex.replyExcludes !== undefined, () => {
      const hit = ex.replyExcludes.filter(x => lower.includes(x));
      return hit.length === 0 ? null : `contains ${hit.join(', ')}`;
    }], ['matches', ex.replyMatches !== undefined, () => ex.replyMatches.some(m => lower.includes(m)) ? null : `none of ${ex.replyMatches.join(', ')}`]];
    for (const [key, active, judge] of checks) {
      if (!active) continue;
      const tally = out[key];
      if (errored) {
        tally.errored += 1;
        continue;
      }
      if (reply === '') {
        tally.noReply += 1;
        continue;
      }
      tally.checked += 1;
      const detail = judge();
      if (detail === null) tally.passed += 1;else tally.misses.push({
        scriptId: t.scriptId,
        turnIndex: t.turnIndex,
        repeat: t.repeat,
        arm: t.arm,
        reply,
        detail
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cards (proposeChanges / applyProposal / cancelProposal)
// ---------------------------------------------------------------------------

/** Per TURN, aggregated over its legs: a card is staged on one leg and the
 *  reply written on another, so a per-leg reading would mislabel both. */
function cardTurn(t) {
  const kinds = [];
  let staged = false;
  let attempts = 0;
  let executed = 0;
  for (const l of t.legs) {
    for (const c of l.toolCalls) {
      const r = c.result && typeof c.result === 'object' ? c.result : null;
      const ok = r !== null && typeof r.error !== 'string';
      if (c.name === 'proposeChanges' && ok) {
        staged = true;
        const acts = Array.isArray(r.actions) ? r.actions : [];
        for (const a of acts) {
          const k = a?.type;
          if (typeof k === 'string') kinds.push(k);
        }
      } else if (c.name === 'applyProposal') {
        attempts += 1;
        if (ok) executed += 1;
      }
    }
  }
  const last = t.legs[t.legs.length - 1];
  return {
    scriptId: t.scriptId,
    turnIndex: t.turnIndex,
    repeat: t.repeat,
    staged,
    kinds,
    applyAttempts: attempts,
    applyExecuted: executed,
    applyRefused: attempts - executed,
    claimsChange: (0, _prose.claimsChangeHappened)((last?.reply ?? '').trim())
  };
}
function cardReport(turns, expectFor) {
  const out = {
    turns: [],
    staged: 0,
    kinds: {},
    applyAttempts: 0,
    applyExecuted: 0,
    applyRefused: 0,
    claimsChange: 0,
    claimsWithoutApply: 0,
    expected: 0,
    met: 0,
    misses: []
  };
  for (const t of turns) {
    const c = cardTurn(t);
    out.turns.push(c);
    if (c.staged) out.staged += 1;
    for (const k of new Set(c.kinds)) out.kinds[k] = (out.kinds[k] ?? 0) + 1;
    out.applyAttempts += c.applyAttempts;
    out.applyExecuted += c.applyExecuted;
    out.applyRefused += c.applyRefused;
    if (c.claimsChange) {
      out.claimsChange += 1;
      if (c.applyExecuted === 0) out.claimsWithoutApply += 1;
    }
    const want = expectFor(t.scriptId, t.turnIndex)?.card;
    if (!want) continue;
    // An errored turn ended early; its missing card is not the agent's miss.
    if (t.endedOn === 'transport_error') continue;
    out.expected += 1;
    const why = [];
    if (want.kinds) {
      const missing = want.kinds.filter(k => !c.kinds.includes(k));
      if (!c.staged) why.push('no card staged');else if (missing.length > 0) why.push(`card lacks ${missing.join(', ')} (has ${c.kinds.join(', ')})`);
    }
    if (want.applied === true && c.applyExecuted === 0) why.push('no applyProposal executed');
    if (want.applied === false && c.applyExecuted > 0) why.push('applyProposal executed');
    if (want.noApply && c.applyAttempts > 0) why.push(`applyProposal attempted x${c.applyAttempts}`);
    if (why.length === 0) out.met += 1;else out.misses.push({
      scriptId: t.scriptId,
      turnIndex: t.turnIndex,
      repeat: t.repeat,
      detail: why.join('; ')
    });
  }
  return out;
}