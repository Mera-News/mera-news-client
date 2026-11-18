"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TAG = exports.HARNESS_TAP_ONLY = exports.FOLLOW_STORY_HINT = void 0;
exports.activeFiltersView = activeFiltersView;
exports.applyToolSideEffects = applyToolSideEffects;
exports.detachedCopy = detachedCopy;
exports.factRemovedLine = factRemovedLine;
exports.finalizeToolCalls = finalizeToolCalls;
exports.followedInChatLabels = followedInChatLabels;
exports.i18nInstance = i18nInstance;
exports.parseToolArgs = parseToolArgs;
exports.pendingCardStatements = pendingCardStatements;
exports.pendingProposalView = pendingProposalView;
exports.refusedOnRetry = refusedOnRetry;
exports.runsOnHarness = runsOnHarness;
exports.scheduleFrame = void 0;
exports.wireMessageTokens = wireMessageTokens;
exports.withCombinedFactMemory = withCombinedFactMemory;
var _logger = _interopRequireDefault(require("../logger"));
var _proposals = require("../news-harness/core/proposals");
var _trackOptions = require("./cards/track-options");
var _cloudChatStore = require("../stores/cloud-chat-store");
var _floatingChatStore = require("../stores/floating-chat-store");
var _factChoiceResolution = require("../chat-tools/fact-choice-resolution");
var _estimateTokens = require("../algorithms/estimate-tokens");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Module-level helpers of the cloud chat engine (createCloudEngine in
// lib/hooks/useCloudPersonaChat.ts). Not pure: stores, i18n and settings.

/**
 * The one-time split offer for a combined "origin plus residence" fact is
 * remembered on the device, so a skipped offer is not repeated on every later
 * residence or origin turn. Stored as a JSON list of fact ids.
 */
const COMBINED_SPLIT_OFFERED_KEY = 'mera_combined_fact_split_offered_v1';

/**
 * Required LAZILY, on purpose. `setting-service` builds its collection at
 * module scope, so a top-level import here constructs a real SQLiteAdapter the
 * moment anything imports this hook, and every suite that renders it dies at
 * load with `initializeJSI`.
 */
function settings() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../database/services/setting-service");
}
async function readSplitOffered() {
  try {
    const raw = await settings().getSetting(COMBINED_SPLIT_OFFERED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
function withCombinedFactMemory(deps) {
  return {
    ...deps,
    combinedFactRewrite: {
      wasOffered: async factId => (await readSplitOffered()).includes(factId),
      markOffered: async factId => {
        const ids = await readSplitOffered();
        if (ids.includes(factId)) return;
        await settings().setSetting(COMBINED_SPLIT_OFFERED_KEY, JSON.stringify([...ids, factId])).catch(() => {});
      }
    }
  };
}

/**
 * Every reading on a fact-choice card in this thread that the user has not
 * answered. The store holds the tool call's staged result; a tap writes an
 * OVERRIDE under `${messageId}::${index}` in the floating-chat store, which
 * wins when present.
 */
function pendingCardStatements(messages) {
  const overrides = _floatingChatStore.useFloatingChatStore.getState().toolCallResults;
  const out = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    m.toolCalls.forEach((tc, idx) => {
      if (tc.name !== 'saveExtractedFacts') return;
      const result = overrides[`${m.id}::${idx}`] ?? tc.result;
      for (const g of (0, _factChoiceResolution.unresolvedGroups)(result)) out.push(...g.options);
    });
  }
  return out;
}

/** The agents the harness loop drives: the persona chat and the follow-a-story chat. */
function runsOnHarness(agentId) {
  return agentId.startsWith('persona-') || agentId.startsWith('follow-story-');
}

/**
 * What a retried turn may not do, because the turn it repeats may have done it
 * already and we cannot tell how far that got. A reader never pays for our
 * interruption: `issueWarning` counts on the server and three block them, and a
 * typed yes on a card waiting on a calibration tap leaves the card staged, so
 * applying it again would repeat its actions. A plain card needs no rule:
 * applying it consumes it. Null when the tool may run.
 */
function refusedOnRetry(name) {
  if (name === 'issueWarning') return {
    blocked: false,
    message: 'Already handled for this message.'
  };
  const card = _floatingChatStore.useFloatingChatStore.getState().proposal;
  if (name === 'applyProposal' && card?.actions.some(a => a.type === 'run_calibration')) {
    return {
      ...(0, _proposals.userTapOnlyRefusal)()
    };
  }
  return null;
}

/** The route leg's one line when the chat was opened to follow a story. */
const FOLLOW_STORY_HINT = exports.FOLLOW_STORY_HINT = 'They opened this chat from their Followed stories page to follow a news story.';

/**
 * Labels of the stories the user followed from follow cards in this thread, in
 * order, deduped. Reads the card's override (`cardOptions`, `followed`) else
 * the staged result; only rows that settled `following` or `already` count, so
 * an unticked grown option never appears.
 */
function followedInChatLabels(messages) {
  const overrides = _floatingChatStore.useFloatingChatStore.getState().toolCallResults;
  const out = [];
  const seen = new Set();
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    m.toolCalls.forEach((tc, idx) => {
      if (tc.name !== 'proposeTrack') return;
      const result = overrides[`${m.id}::${idx}`] ?? tc.result ?? {};
      const outcomes = (0, _trackOptions.readTrackOutcomes)(result.followed);
      const shown = (0, _trackOptions.readCardOptions)(result.cardOptions) ?? (0, _trackOptions.readCardOptions)(result.options) ?? [];
      for (const {
        label
      } of shown) {
        const key = (0, _trackOptions.normaliseTrackText)(label);
        const outcome = outcomes[key];
        if ((outcome === 'following' || outcome === 'already') && !seen.has(key)) {
          seen.add(key);
          out.push(label);
        }
      }
    });
  }
  return out;
}

/**
 * What a tool's execution asks the chat to do: block it, stage a card, settle
 * the waiting card. ONE place for both the single-shot path and the harness
 * card tools. `cloud` is the engine's own (possibly detached) store handle; the
 * floating-chat writes are skipped once the engine is disposed.
 */
function applyToolSideEffects(sideEffects, {
  alive,
  cloud = _cloudChatStore.useCloudChatStore.getState()
}) {
  if (!sideEffects) return;
  if (sideEffects.blocked) {
    cloud.setIsBlocked(true);
    cloud.setBlockedReason(sideEffects.blocked.reason);
  }
  if (sideEffects.proposal && alive) _floatingChatStore.useFloatingChatStore.getState().setProposal(sideEffects.proposal);
  if (sideEffects.proposalResolved && alive) {
    _floatingChatStore.useFloatingChatStore.getState().resolveProposal(sideEffects.proposalResolved);
  }
}

/**
 * Actions a typed "yes" must never apply: they skip the loop's save
 * normalisation, the delete gate, mayReplace and the topic veto. Only the
 * card's tap runs those paths.
 */
const HARNESS_TAP_ONLY = exports.HARNESS_TAP_ONLY = new Set(['run_calibration', 'fact_check_claim', 'add_fact', 'update_fact', 'delete_fact', 'add_topics', 'remove_topics']);

/** The card on screen, as the loop sees it; null once it is settled or absent. */
function pendingProposalView() {
  const {
    proposal: p,
    resolvedProposals
  } = _floatingChatStore.useFloatingChatStore.getState();
  if (!p || resolvedProposals[p.id]) return null;
  const chooseOne = (0, _proposals.proposalRequiresUserChoice)(p);
  return {
    id: p.id,
    summary: p.explanation || p.actions.map(a => a.label ?? a.type).join(', '),
    chooseOne,
    multiSelect: (0, _proposals.proposalAllowsMultiSelect)(p),
    appliable: !chooseOne && !p.actions.some(a => HARNESS_TAP_ONLY.has(a.type))
  };
}

/** The user's active filters for the loop's state; best effort. */
async function activeFiltersView() {
  try {
    // Lazy: the suppression service builds its collection at module scope.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rows = await require("../database/services/suppression-service").getActive();
    return rows.map(r => ({
      id: r.id,
      pattern: r.pattern
    }));
  } catch {
    return [];
  }
}

/** Tool arguments arrive as a JSON string. A malformed one must yield an empty
 *  object rather than throwing: this runs inside the live progress write-back,
 *  and a throw there would kill the turn over a cosmetic row. */
function parseToolArgs(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Required lazily: lib/i18n pulls the OS translator's native module at load. */
function i18nInstance() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../platform/i18n").default;
}

/** The fixed removal line, in the reader's language. */
function factRemovedLine(statements) {
  return i18nInstance().t('chat.factRemovedLine', {
    facts: statements.map(s => `"${s}"`).join(', ')
  });
}
const TAG = exports.TAG = '[CloudChat]';
/** The store's state with every action a no-op: what a disposed engine writes to. */
function detachedCopy(state) {
  const copy = {};
  for (const [key, value] of Object.entries(state)) copy[key] = typeof value === 'function' ? () => {} : value;
  return copy;
}

/** Next-frame scheduler for the streaming bubble. RN provides
 *  requestAnimationFrame; the timeout fallback keeps the hook usable under a
 *  test runtime without it. */
const scheduleFrame = cb => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(cb);
  } else {
    setTimeout(cb, 16);
  }
};

// Cloud chat carries a TOKEN-BUDGETED window of recent turns (see
// lib/news-harness/persona-management/history-window.ts). It used to send only
// the current user turn, which meant a tail of [..., user("Yes")] reached the
// model as the bare word "Yes" with no trace of the question it answered — the
// reported bug where Mera responded to a confirmation with "Great, good to see
// you again!".
//
// Fresh facts are still re-loaded from the `facts` table every turn via
// buildContext() and injected onto the LAST user message only, so a wider
// window never lets the LLM hallucinate persisted state from a stale assistant
// claim like "Got it, saved" — the facts block always reflects the database,
// not the conversation.
exports.scheduleFrame = scheduleFrame;
function wireMessageTokens(m) {
  const content = typeof m.content === 'string' ? m.content : '';
  const calls = 'tool_calls' in m && m.tool_calls ? JSON.stringify(m.tool_calls) : '';
  return (0, _estimateTokens.estimateTokens)(content) + (0, _estimateTokens.estimateTokens)(calls);
}

// ---------------------------------------------------------------------------
// Accumulate tool-call deltas by index into complete tool calls
// ---------------------------------------------------------------------------

function finalizeToolCalls(accumulators) {
  const results = [];
  for (const [, acc] of accumulators) {
    if (!acc.name) continue;
    try {
      const input = acc.arguments ? JSON.parse(acc.arguments) : {};
      results.push({
        id: acc.id,
        name: acc.name,
        input
      });
    } catch {
      // Do NOT substitute `{}`. That turned a truncated or corrupt call into a
      // well-formed one with no arguments, which the handlers then answered as
      // an ordinary validation failure ("fact_ids must be a non-empty array") —
      // telling the model its ARGUMENTS were wrong when in fact its
      // SERIALIZATION was, and making a dropped call look like a successful
      // no-op in the logs.
      _logger.default.warn(`${TAG} Failed to parse tool call arguments`, {
        name: acc.name,
        // Lengths only: the arguments are the user's facts, and a warning is a
        // Sentry breadcrumb in production.
        argsLength: acc.arguments.length
      });
      _logger.default.captureMessage(`${TAG} malformed tool arguments`, {
        level: 'warning',
        tags: {
          component: 'useCloudPersonaChat'
        },
        extra: {
          tool: acc.name,
          argsLength: acc.arguments.length
        }
      });
      results.push({
        id: acc.id,
        name: acc.name,
        input: null,
        malformed: true
      });
    }
  }
  return results;
}