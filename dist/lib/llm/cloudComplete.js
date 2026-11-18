"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "CallerAbortError", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.CallerAbortError;
  }
});
Object.defineProperty(exports, "CleartextToolCallError", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.CleartextToolCallError;
  }
});
Object.defineProperty(exports, "MAX_ATTEMPTS", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.MAX_ATTEMPTS;
  }
});
Object.defineProperty(exports, "RateLimitedError", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.RateLimitedError;
  }
});
Object.defineProperty(exports, "STREAM_IDLE_TIMEOUT_MS", {
  enumerable: true,
  get: function () {
    return _chatResponse.STREAM_IDLE_TIMEOUT_MS;
  }
});
Object.defineProperty(exports, "StreamIdleError", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.StreamIdleError;
  }
});
Object.defineProperty(exports, "UPSTREAM_ALIGNED_TIMEOUT_MS", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.UPSTREAM_ALIGNED_TIMEOUT_MS;
  }
});
Object.defineProperty(exports, "authFetch", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.authFetch;
  }
});
exports.cloudBatchComplete = cloudBatchComplete;
exports.cloudChatStream = cloudChatStream;
exports.cloudComplete = cloudComplete;
Object.defineProperty(exports, "isAbortLike", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.isAbortLike;
  }
});
Object.defineProperty(exports, "isCallerAbort", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.isCallerAbort;
  }
});
Object.defineProperty(exports, "retryAfterMsFrom", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.retryAfterMsFrom;
  }
});
Object.defineProperty(exports, "takeStreamHandle", {
  enumerable: true,
  get: function () {
    return _gatewayFetch.takeStreamHandle;
  }
});
exports.transportServesJobs = transportServesJobs;
exports.usesGateway = usesGateway;
var _gatewayTransport = require("./gateway-transport");
var _platform = require("../platform");
var _gatewayFetch = require("./gateway-fetch");
var _chatResponse = require("./chat-response");
// cloudComplete — cloud LLM completion, batch completion, and streaming chat: the three calls
// every caller makes, and their request types. Each one hands the call to the transport
// (LlmTransport below): the host's own when it brings one, else Mera's inference gateway
// (gateway-transport.ts), where the router, the profiles, the rate limiter, end-to-end encryption
// and the async jobs live.

// Everything that moved out is re-exported, so this module's export list is unchanged.

// Canonical home is now lib/news-harness/core/types.ts; re-exported here so
// importers of BatchCompletionResult from this module keep working.

/**
 * Where a cloud model call goes. A transport takes the call whole: it picks the model for the
 * lane, sends, retries and reads the answer. Every implementation calls `assertCloudAllowed`
 * first, so on-device mode never reaches a cloud model. Errors keep the shapes callers already
 * handle (CallerAbortError, LaneExhaustedError, `statusCode` on an HTTP failure).
 */

/** The host's transport when it brings one, else Mera's gateway. Read at every call. */
function transport() {
  return (0, _platform.platform)('llm-transport').llmTransport ?? _gatewayTransport.gatewayTransport;
}

/** False when the host brings its own transport: nothing then goes to Mera's gateway. Read at call time. */
function usesGateway() {
  return (0, _platform.platform)('llm-transport').llmTransport === undefined;
}

/** Whether scoring may submit async inference jobs to the active transport. */
function transportServesJobs() {
  return transport().asyncJobs !== false;
}
/** Single completion call. Served by `request.route`'s profiles, in the router's order. */
function cloudComplete(request, options = {}) {
  return transport().complete(request, options);
}

/** Batch completion: many calls in one request where the transport can, results in item order. */
function cloudBatchComplete(calls, route = 'background', options = {}) {
  return transport().batch(calls, route, options);
}

// ---------------------------------------------------------------------------
// Wire types for OpenAI-format messages
// ---------------------------------------------------------------------------

/** Streaming chat: one leg of a chat turn as events (see the gateway transport for the detail). */
function cloudChatStream(request) {
  return transport().chat(request);
}