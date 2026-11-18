"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TurnResumeError = void 0;
exports.readStoredTurn = readStoredTurn;
exports.turnReader = turnReader;
var _appRestart = require("../app-restart");
var _sleep = require("../utils/sleep");
var _abortRace = require("./abort-race");
var _gatewayFetch = require("./gateway-fetch");
// chat-turn: reads a detached chat reply back from the gateway's turn store.
//
// The gateway keeps the raw ciphertext stream by turn id, so a reply survives
// the socket. The client continues the same byte stream from its cursor; the
// keypair of the attempt is in memory for as long as this JS context lives.
// Imports gateway-fetch only.

const POLL_MS = 1_000;
const MAX_POLL_MS = 4_000;
const READ_TIMEOUT_MS = 15_000;

/** The silence a poll accepts once bytes are flowing: the live stream's idle
 *  window (STREAM_IDLE_TIMEOUT_MS; chat-response imports this file). */
const TURN_STALL_MS = 30_000;

/** The reader the SSE path reads, socket first and the store after. */

/** The store has no complete reply for this turn: re-send the leg. */
class TurnResumeError extends Error {
  constructor(why) {
    super(`[CloudLLM] turn not resumable: ${why}`);
    this.name = 'TurnResumeError';
  }
}

/** One step of the poll. `done` means the bytes reach the end of the reply. */
exports.TurnResumeError = TurnResumeError;
function storePoller(resume, signal) {
  const {
    turn
  } = resume;
  let delay = POLL_MS;
  // Wall time, so a hanging read counts, restarted by a departure, so time away
  // does not.
  let since = Date.now();
  let leftSince = (0, _appRestart.departureMark)();
  let first = true;
  let ended = null;
  const waitMore = () => {
    if (leftSince()) {
      leftSince = (0, _appRestart.departureMark)();
      since = Date.now();
    }
    const budget = turn.bytes > 0 ? TURN_STALL_MS : _gatewayFetch.UPSTREAM_ALIGNED_TIMEOUT_MS;
    if (Date.now() - since >= budget) throw new TurnResumeError('stalled');
    delay = Math.min(delay * 2, MAX_POLL_MS);
  };
  return async () => {
    for (;;) {
      if (ended === 'done') return {
        done: true
      };
      if (ended === 'failed') throw new TurnResumeError('failed after partial bytes');
      if (!first) await (0, _abortRace.raceSignal)((0, _sleep.sleep)(delay), signal).catch(() => {/* checked next */});
      first = false;
      if (signal?.aborted) throw new _gatewayFetch.CallerAbortError('cloudChatStream: stopped');
      let response;
      try {
        // authFetch brings the 401 re-mint, the 503 retry, the hold while away
        // and the interactive lane's 1s spacing.
        response = await (0, _gatewayFetch.authFetch)(`${(0, _gatewayFetch.turnUrl)(turn.id)}?after=${turn.bytes}`, {
          method: 'GET',
          headers: await (0, _gatewayFetch.getAuthHeaders)(),
          ...(signal ? {
            signal
          } : {})
        }, {
          lane: 'interactive',
          maxTimeoutAttempts: 1,
          requestTimeoutMs: READ_TIMEOUT_MS
        });
      } catch (err) {
        if (signal?.aborted) throw new _gatewayFetch.CallerAbortError('cloudChatStream: stopped', err);
        waitMore();
        continue;
      }
      if (response.status === 404 || response.status === 400) throw new TurnResumeError('gone');
      if (!response.ok) {
        waitMore();
        continue;
      }
      const status = response.headers.get('X-Mera-Turn-Status');
      const upstream = Number(response.headers.get('X-Mera-Turn-Upstream-Status') ?? 200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (status === 'done') ended = upstream >= 200 && upstream < 300 ? 'done' : 'failed';else if (status !== 'running') ended = 'failed';
      if (bytes.length > 0) {
        turn.bytes += bytes.length;
        since = Date.now();
        delay = POLL_MS;
        return {
          done: false,
          value: bytes
        };
      }
      if (ended === 'done' && turn.bytes === 0) throw new TurnResumeError('empty');
      if (ended === null) waitMore();
    }
  };
}

/** Socket bytes until the app has left and the socket gives out, then the store. */
function turnReader(socket, resume, handle, signal) {
  const {
    turn,
    left
  } = resume;
  let onStore = socket === null;
  let stopped = false;
  const poll = storePoller(resume, signal);
  const leaveSocket = () => {
    onStore = true;
    handle?.abort();
    void socket?.cancel().catch(() => {/* already dead */});
  };
  return {
    polling: () => onStore,
    takeOver: () => {
      if (onStore || !left()) return false;
      leaveSocket();
      return true;
    },
    cancel: async () => {
      stopped = true;
      await socket?.cancel();
    },
    read: async () => {
      if (!onStore) {
        try {
          const result = await socket.read();
          if (!result.done) {
            turn.bytes += result.value.byteLength;
            return result;
          }
          if (stopped || !left()) return result;
        } catch (err) {
          if (stopped || !left()) throw err;
        }
        onStore = true;
      }
      if (stopped) return {
        done: true,
        value: undefined
      };
      turn.polled = true;
      await (0, _appRestart.whenForeground)(signal);
      return await poll();
    }
  };
}

/** The whole stored reply of a buffered leg. */
async function readStoredTurn(resume, signal) {
  resume.turn.polled = true;
  const poll = storePoller(resume, signal);
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const step = await poll();
    if (step.done) return text + decoder.decode();
    text += decoder.decode(step.value, {
      stream: true
    });
  }
}