"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.askImpactQuestion = askImpactQuestion;
exports.attachChatSession = attachChatSession;
exports.canRegenerateWithWebSearch = canRegenerateWithWebSearch;
exports.canRequestMoreOptions = canRequestMoreOptions;
exports.canRetryChatTurn = canRetryChatTurn;
exports.flushRemovedFacts = flushRemovedFacts;
exports.noteRemovedFact = noteRemovedFact;
exports.pendingRemovedFacts = pendingRemovedFacts;
exports.requestMoreOptions = requestMoreOptions;
exports.resetChatSession = resetChatSession;
exports.retryChatTurn = retryChatTurn;
exports.scriptedExchange = scriptedExchange;
exports.stopChatTurn = stopChatTurn;
var _appRestart = require("../app-restart");
var _logger = _interopRequireDefault(require("../logger"));
var _cloudChatStore = require("../stores/cloud-chat-store");
var _floatingChatStore = require("../stores/floating-chat-store");
var _engine = require("./engine");
var _localChatStore = require("./local-chat-store");
var _persist = require("./persist");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// THE CHAT SESSION: the one live chat engine in this JS process, and the
// whole-turn lifecycle around it. No component owns any of it, so closing the
// chat, switching tabs or remounting the view never ends a turn.
//
// The view (CloudPersonaChat / LocalPersonaChat -> ChatSessionView) only
// attaches, reads the stores and passes input in. The session:
// - keeps the engine for a conversation until a different one attaches;
// - holds `holdRestart('chat-stream')` for exactly as long as a turn is busy,
//   so an OTA restart can never land mid-turn (the ONE acquire and the ONE
//   release are in `sync`);
// - mirrors that busy flag to floating-chat-store (`setGenerating`), which
//   also derives the memory-only unread flag for the Mera button;
// - writes finished messages to the `messages` table (`toPersist`).
//
// BUSY IS THE WHOLE TURN on either engine, never `status`: both engines keep
// doing real work (the cloud loop's device tools between legs, on-device tool
// execution) after their text has stopped.

let live = null;
let release = null;
let wired = false;
/** A More options call is running. Counts as busy so Stop shows; deliberately
 *  NOT `agentTurnState.turnActive`, which would reopen the last steps box. */
let moreOptionsInFlight = false;

/** Engine factories, required lazily: they pull in the inference stack. The
 *  view pairs the kind with its agent (createAgentForContext). */
function createEngine(kind, agent) {
  if (kind === 'cloud') {
    const {
      createCloudEngine
    } = require("./useCloudPersonaChat");
    return createCloudEngine(agent);
  }
  const {
    createLocalEngine
  } = require("../llm/useLocalLLM");
  return createLocalEngine(agent);
}
function busyNow() {
  const cloud = _cloudChatStore.useCloudChatStore.getState();
  const local = _localChatStore.useLocalChatStore.getState();
  return moreOptionsInFlight || cloud.status === 'streaming' || cloud.agentTurnState?.turnActive === true || local.status === 'streaming' || local.turnBusy;
}
function write(conversationId, message) {
  const {
    appendMessage
  } = require("../database/services/conversation-service");
  const fail = error => _logger.default.error('[ChatSession] failed to persist a message', {
    role: message.role,
    error: String(error)
  });
  if (message.role !== 'assistant') {
    appendMessage(conversationId, {
      role: 'user',
      content: message.content
    }, message.id).catch(fail);
    return;
  }
  // A tool-result override recorded before this row existed (a fast tap on
  // a fact card) is merged in here; `patchMessageToolCallResult` is the
  // other half, for taps after the row exists.
  const overrides = _floatingChatStore.useFloatingChatStore.getState().toolCallResults;
  const toolCalls = (message.toolCalls ?? []).map((tc, idx) => {
    const override = overrides[`${message.id}::${idx}`];
    return override ? {
      ...tc,
      result: override,
      status: 'done'
    } : tc;
  });
  appendMessage(conversationId, {
    role: 'assistant',
    content: message.content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    failed: message.failed
  }, message.id).catch(fail);
}
function persist() {
  if (!live) return;
  const state = live.kind === 'cloud' ? _cloudChatStore.useCloudChatStore.getState() : _localChatStore.useLocalChatStore.getState();
  const plan = (0, _persist.toPersist)(state.messages, state.status, live.persisted);
  for (const id of plan.claim) live.persisted.add(id);
  for (const message of plan.write) write(live.conversationId, message);
}

/** Removed facts Mera has not told the reader about yet, in memory. A kill loses
 *  them, and the tombstone stays as the notice. */
const removedFacts = [];
let flushingRemoved = false;
function noteRemovedFact(statement) {
  removedFacts.push(statement);
}
function pendingRemovedFacts() {
  return removedFacts;
}

/**
 * One reply for every fact waiting. Holds while a turn runs or another topic
 * job could still add to the list, and `exceptFactId` is the job calling from
 * its own finally, whose row is still active.
 */
async function flushRemovedFacts(exceptFactId) {
  if (flushingRemoved || removedFacts.length === 0) return;
  flushingRemoved = true;
  try {
    const {
      getActiveTopicGenFactIds
    } = require("../database/services/inference-job-service");
    const active = await getActiveTopicGenFactIds();
    if (exceptFactId) active.delete(exceptFactId);
    if (active.size > 0 || busyNow() || !live?.engine.tellRemovedFacts) return;
    live.engine.tellRemovedFacts(removedFacts.splice(0));
  } finally {
    flushingRemoved = false;
  }
}
function sync() {
  const busy = busyNow();
  if (busy && !release) release = (0, _appRestart.holdRestart)('chat-stream');
  if (!busy && release) {
    release();
    release = null;
  }
  if (_floatingChatStore.useFloatingChatStore.getState().isGenerating !== busy) {
    _floatingChatStore.useFloatingChatStore.getState().setGenerating(busy);
  }
  persist();
  if (!busy && removedFacts.length > 0) void flushRemovedFacts().catch(() => {});
}
function wire() {
  if (wired) return;
  wired = true;
  _cloudChatStore.useCloudChatStore.subscribe(sync);
  _localChatStore.useLocalChatStore.subscribe(sync);
}
/**
 * The engine for this conversation: the live one when it matches, else a new
 * one. Never called during render: the view attaches from an effect and from
 * its send. The thread itself is emptied by `resetChatSession` when a
 * conversation is created, not here.
 */
function attachChatSession(opts) {
  wire();
  if (live && live.conversationId === opts.conversationId && live.kind === opts.kind) {
    live.engine.setAgent(opts.agent);
    for (const id of opts.persistedIds) live.persisted.add(id);
    return live.engine;
  }
  live?.engine.dispose();
  live = {
    conversationId: opts.conversationId,
    kind: opts.kind,
    engine: createEngine(opts.kind, opts.agent),
    persisted: new Set(opts.persistedIds)
  };
  sync();
  return live.engine;
}

/**
 * THE STOP BUTTON. Aborts whatever the live engine is doing: the stream, the
 * agent loop's next leg, any tool not yet started, a queued
 * hidden turn. A no-op when nothing is busy. The engine settles itself (busy
 * clears through its own store, which `sync` mirrors), so the composer is ready
 * at once and no "answer ready" ring is left behind.
 */
function stopChatTurn() {
  if (!live || !busyNow()) return;
  removedFacts.length = 0;
  live.engine.stop();
}

/** A turn a kill ended, when this is the kind of chat it came from. */
function killedTurnHere() {
  const {
    interruptedTurn,
    context
  } = _floatingChatStore.useFloatingChatStore.getState();
  return interruptedTurn?.contextKind === context.kind ? interruptedTurn : null;
}

/** Retry is on offer: nothing is busy, and the last turn failed having changed
 *  nothing, or a kill ended one in this kind of chat. */
function canRetryChatTurn() {
  if (!live || busyNow()) return false;
  return live.engine.canRetry?.() === true || killedTurnHere() !== null;
}

/** THE ONE RETRY. False when no turn started, and then nothing has changed. */
function retryChatTurn() {
  if (!live || !canRetryChatTurn()) return false;
  const {
    engine,
    persisted
  } = live;
  if (engine.canRetry?.()) return engine.retry?.() === true;
  const killed = killedTurnHere();
  if (!killed) return false;
  // A reopened old chat shows the message already, so its row stays.
  const held = killed.messageId && persisted.has(killed.messageId) ? killed.messageId : undefined;
  if (engine.retry) {
    if (!engine.retry({
      text: killed.text,
      heldMessageId: held
    })) return false;
  } else {
    engine.send(killed.text);
  }
  _floatingChatStore.useFloatingChatStore.getState().setInterruptedTurn(null);
  if (killed.messageId && !held) {
    const {
      deleteInterruptedMessage
    } = require("./turn-inflight");
    deleteInterruptedMessage(killed.messageId);
  }
  return true;
}

/** The live engine can grow a follow card. The card hides "More options" when not. */
function canRequestMoreOptions() {
  return typeof live?.engine.moreOptions === 'function';
}

/** The live engine can search the web for a follow card: the cloud engine only. */
function canRegenerateWithWebSearch() {
  return live?.kind === 'cloud' && typeof live.engine.moreOptions === 'function';
}

/**
 * "More options" on a follow card, built from the card alone: its effective
 * options (grown ones included) and their subject. Never throws.
 *
 * With `web`, "Regenerate with web search": the device searches `web.query`
 * first, and only the rows `web.keep` names count as shown, so the rest can be replaced.
 */
async function requestMoreOptions(proposalId, cardActions, web) {
  const tracks = cardActions.filter(a => a.type === 'track_story');
  const shown = web ? tracks.filter(a => web.keep(a.label)) : tracks;
  const room = _engine.MAX_FOLLOW_OPTIONS - shown.length;
  const engine = live?.engine;
  if (tracks.length === 0 || room < 1 || !engine?.moreOptions) return {
    actions: [],
    reason: 'none'
  };
  if (web && !canRegenerateWithWebSearch()) return {
    actions: [],
    reason: 'failed'
  };
  moreOptionsInFlight = true;
  sync();
  try {
    return await engine.moreOptions({
      proposalId,
      shown: shown.map(a => ({
        label: a.label,
        searchText: a.searchText
      })),
      room,
      subject: tracks[0].subject,
      ...(web ? {
        webQuery: web.query
      } : {})
    });
  } catch (err) {
    _logger.default.warn('[chat-session] moreOptions threw', {
      error: String(err)
    });
    return {
      actions: [],
      reason: 'failed'
    };
  } finally {
    moreOptionsInFlight = false;
    sync();
  }
}

/** The impact question on a follow card. Answers nothing: the row is the result. */
async function askImpactQuestion(question) {
  await live?.engine.askImpact?.(question);
}

/** An onboarding line, with no model call. False when it did not land: a turn is
 *  running, no chat is attached, or the engine has none (on device). */
async function scriptedExchange(exchange) {
  return (await live?.engine.scriptedExchange?.(exchange)) === true;
}

/**
 * A fresh thread: no engine and empty stores. MeraChatSession calls it when it
 * creates a conversation (launch, New chat, a context switch); clearAllStores
 * calls it on an account switch. With the stores idle the hold is released.
 */
function resetChatSession() {
  live?.engine.dispose();
  live = null;
  // The tap opens a fresh chat, and its reset must not eat the note it queued.
  if (!_floatingChatStore.useFloatingChatStore.getState().isExpanded) removedFacts.length = 0;
  (0, _localChatStore.resetLocalChat)();
  _cloudChatStore.useCloudChatStore.getState().reset();
  release?.();
  release = null;
}