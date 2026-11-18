"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.createLocalEngine = createLocalEngine;
var _cloudEngineHelpers = require("../chat-session/cloud-engine-helpers");
var _localChatStore = require("../chat-session/local-chat-store");
var _InferenceQueue = require("../inference/InferenceQueue");
var _chatPhase = require("../services/chat-phase");
var _chatPhaseStore = require("./chat-phase-store");
var _floatingChatStore = require("../stores/floating-chat-store");
var _logger = _interopRequireDefault(require("../logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// The on-device chat engine. The file keeps its old name; it is no longer a
// hook. `createLocalEngine` is owned by the chat session (lib/chat-session), so
// a turn survives the chat being closed.
//
// The turn itself belongs to the on-device agent (lib/llm/agents/on-device):
// it builds its prompt, runs the model (structured output, or a plain stream
// for tutorial help) and names the executor tools its reply maps to. This file
// shows the reply and runs those tools exactly as cloud tool calls run, so the
// cards (fact choices, proposals, story options) are the same ones.

const TAG = '[LocalLLM]';

// Module-level counter ensures unique tool call IDs across all inference runs.
let toolCallCounter = 0;
// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

function createLocalEngine(initialAgent) {
  // State lives in useLocalChatStore so it outlives every component. Writes
  // stop once the engine is replaced (a new chat), so a turn still finishing
  // in the background can never touch the next conversation's thread.
  let alive = true;
  const st = _localChatStore.useLocalChatStore.getState;
  const put = patch => {
    if (alive) _localChatStore.useLocalChatStore.setState(patch);
  };
  const setMessages = next => put({
    messages: typeof next === 'function' ? next(st().messages) : next
  });
  const setStatus = status => put({
    status
  });
  // Deliberately NOT cleared at the same point as `status`: see the store's
  // doc on `turnBusy`. Cleared only in `runInference`'s outer `finally`, the
  // one place the whole turn (stream AND tools) is actually done.
  const setTurnBusy = turnBusy => put({
    turnBusy
  });
  const setIsBlocked = isBlocked => put({
    isBlocked
  });
  const setBlockedReason = blockedReason => put({
    blockedReason
  });
  const setError = error => put({
    error
  });
  const agentRef = {
    current: initialAgent
  };
  /** Stop pressed while a More options call ran: its answer is discarded. */
  let moreStopped = false;
  const isStreamingRef = {
    current: false
  };
  /** THE STOP BUTTON, for the turn in flight. Read by the text sink and at the
   *  early-exit points before a completion starts. */
  const stopRef = {
    requested: false
  };
  /** Aborted by Stop: wakes the turn at once and tells the toolkit to halt a
   *  stream, neither of which waits for a token. One per turn. */
  const abortRef = {
    current: new AbortController()
  };

  /**
   * The wait line's sink for the turn in flight.
   *
   * On-device has no queue, no attestation and no network, so it gets its own
   * three disjoint phase ids and its own copy, which may never mention
   * encryption or a server. Nothing leaves the phone on this path and a line
   * implying otherwise is a false claim, not a cosmetic slip.
   */
  const phaseSinkRef = {
    current: null
  };
  const runInference = async conversationMessages => {
    // Published SYNCHRONOUSLY, before the first await: `inferenceQueue.pause()`
    // waits for whatever job holds the model to finish, real seconds the user
    // sits through. The text runs on the phone's built-in model, which loads
    // nothing, so there is no cold-model line.
    const phase = phaseSinkRef.current;
    phase?.('devicePreparing');
    await _InferenceQueue.inferenceQueue.pause();
    try {
      // Stop pressed while the queue paused: end the turn, start no completion.
      if (stopRef.requested) return;
      const assistantId = `asst-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      let accContent = '';
      const placeholder = {
        id: assistantId,
        role: 'assistant',
        content: '',
        toolCalls: []
      };
      setMessages([...conversationMessages, placeholder]);
      const setContent = (content, extra = {}) => setMessages(prev => prev.map(m => m.id === assistantId ? {
        ...m,
        content,
        ...extra
      } : m));
      phase?.('deviceThinking');

      // Stop must end the turn NOW, but a structured call cannot be cut short
      // and a stream only ends once the model has unwound. So the turn races
      // the abort, and an abandoned turn finishes (and is ignored) in the
      // background; the toolkit releases its lock on its own.
      const signal = abortRef.current.signal;
      const aborted = new Promise(resolve => {
        if (signal.aborted) resolve('aborted');else signal.addEventListener('abort', () => resolve('aborted'), {
          once: true
        });
      });
      const turn = agentRef.current.respond(conversationMessages, {
        signal,
        onText: delta => {
          if (stopRef.requested) return;
          // Real text. The bubble is the liveness signal from here; the sink
          // swallows a repeat, so this costs one store write on the first delta.
          phase?.(null);
          accContent += delta;
          setContent(accContent);
        }
      });
      turn.catch(() => {}); // an abandoned turn may reject later; nobody is waiting
      const outcome = await Promise.race([turn, aborted]);
      if (outcome === 'aborted' || stopRef.requested) {
        // STOPPED: the partial reply stays; nothing is staged or run.
        setContent(accContent, {
          toolCalls: undefined,
          stopped: true
        });
        return;
      }
      phase?.(null);
      const accToolCalls = outcome.calls.map(c => ({
        id: `local-tc-${toolCallCounter++}`,
        name: c.name,
        input: c.input,
        status: 'pending'
      }));
      _logger.default.debug(`${TAG} turn complete`, {
        replyLength: outcome.reply.length,
        tools: accToolCalls.map(t => t.name)
      });
      setContent(outcome.reply, {
        toolCalls: accToolCalls
      });

      // Release input before tool execution — tools are background work,
      // the user can start typing their next message immediately.
      if (accToolCalls.length > 0) {
        setStatus('idle');
        isStreamingRef.current = false;
      }

      // Execute tool calls sequentially
      _logger.default.debug(`${TAG} executing ${accToolCalls.length} tool call(s)`);
      for (const tc of accToolCalls) {
        try {
          _logger.default.debug(`${TAG} executing tool`, {
            name: tc.name,
            inputKeys: Object.keys(tc.input)
          });
          const {
            result,
            sideEffects
          } = await agentRef.current.executeTool(tc.name, tc.input);
          _logger.default.debug(`${TAG} tool result`, {
            name: tc.name,
            resultLength: JSON.stringify(result).length,
            sideEffects: sideEffects ? Object.keys(sideEffects) : []
          });
          if (sideEffects?.blocked) {
            setIsBlocked(true);
            setBlockedReason(sideEffects.blocked.reason);
          }
          if (sideEffects?.proposal) {
            _floatingChatStore.useFloatingChatStore.getState().setProposal(sideEffects.proposal);
          }
          if (sideEffects?.proposalResolved) {
            _floatingChatStore.useFloatingChatStore.getState().resolveProposal(sideEffects.proposalResolved);
          }
          tc.result = result;
          tc.status = 'done';
          setMessages(prev => prev.map(m => m.id === assistantId ? {
            ...m,
            toolCalls: m.toolCalls?.map(t => t.id === tc.id ? {
              ...t,
              result,
              status: 'done'
            } : t)
          } : m));
        } catch (err) {
          tc.status = 'error';
          setMessages(prev => prev.map(m => m.id === assistantId ? {
            ...m,
            toolCalls: m.toolCalls?.map(t => t.id === tc.id ? {
              ...t,
              status: 'error'
            } : t)
          } : m));
          _logger.default.error(`${TAG} tool execution failed`, {
            tool: tc.name,
            error: String(err),
            stack: err?.stack
          });
        }
      }
    } catch (err) {
      const msg = `Inference failed: ${err?.message ?? String(err)}`;
      _logger.default.error(`${TAG} runInference failed`, {
        error: String(err),
        stack: err?.stack
      });
      setError(msg);
    } finally {
      _logger.default.debug(`${TAG} inference done, setting idle`);
      // On the throw path too. A local failure leaves the same generic error
      // banner as a cloud one, and a line still saying "thinking it through
      // on your phone" underneath it is the worse half of the bug.
      phase?.(null);
      if (phaseSinkRef.current === phase) phaseSinkRef.current = null;
      _InferenceQueue.inferenceQueue.resume();
      setStatus('idle');
      isStreamingRef.current = false;
      // The ONE place `turnBusy` clears. Never at the early release above —
      // that early release IS the gap this flag exists to cover.
      setTurnBusy(false);
    }
  };

  /**
   * One turn. `hidden` makes it invisible to the user and unpersisted, while the
   * model still reads it as an ordinary trailing `user` turn.
   *
   * It HAS to be a user turn on this path: the on-device flows render the
   * thread as `User:` / `Mera:` lines, and one ending on Mera's own line makes
   * a small model continue its previous message.
   */
  const startTurn = (text, hidden) => {
    if (isStreamingRef.current || st().turnBusy || st().isBlocked) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    _logger.default.debug(`${TAG} startTurn`, {
      length: trimmed.length,
      hidden
    });
    setError(null);
    const userMsg = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
      ...(hidden ? {
        hidden: true
      } : {})
    };
    const newMessages = [...st().messages, userMsg];
    setMessages(newMessages);
    stopRef.requested = false;
    abortRef.current = new AbortController();
    isStreamingRef.current = true;
    setStatus('streaming');
    setTurnBusy(true);

    // Created here rather than in `runInference` so the mark is per TURN and
    // exists before the first await inside it.
    _chatPhaseStore.useChatPhaseStore.getState().reset();
    phaseSinkRef.current = (0, _chatPhase.makePhaseSink)(_chatPhaseStore.applyChatPhase);
    void runInference(newMessages);
  };
  return {
    send: text => startTurn(text, false),
    sendHidden: text => startTurn(text, true),
    setAgent: agent => {
      agentRef.current = agent;
    },
    // The fixed line: the built-in writer cannot be relied on to quote a fact exactly.
    tellRemovedFacts: statements => {
      setMessages([...st().messages, {
        id: `asst-${Date.now()}`,
        role: 'assistant',
        content: (0, _cloudEngineHelpers.factRemovedLine)(statements)
      }]);
    },
    moreOptions: async req => {
      const agent = agentRef.current;
      if (!agent.moreOptions) return {
        actions: [],
        reason: 'none'
      };
      if (isStreamingRef.current || st().turnBusy) return {
        actions: [],
        reason: 'busy'
      };
      moreStopped = false;
      const result = await agent.moreOptions(req).catch(() => ({
        actions: [],
        reason: 'failed'
      }));
      return moreStopped ? {
        actions: [],
        reason: 'stopped'
      } : result;
    },
    stop: () => {
      moreStopped = true;
      stopRef.requested = true;
      abortRef.current.abort();
    },
    dispose: () => {
      alive = false;
    }
  };
}