"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.chatRunsInCloud = chatRunsInCloud;
exports.useChatRunsInCloud = void 0;
var _graphqlTypes = require("../generated/graphql-types");
var _meraProtocolStore = require("../stores/mera-protocol-store");
// Where CHAT runs. Private cloud runs everything in the cloud; On this phone runs
// chat on the phone unless the reader turned on cloud chat (`chatInCloud`), and
// even then the feed, topic gen and every background job stay on the phone
// (they read `processingMode`, never this). The gate's async twin of this rule is
// `assertCloudAllowed('chat')` in on-device-gate.ts.

const runsInCloud = s => s.processingMode !== _graphqlTypes.ProcessingMode.OnDevice || s.chatInCloud === true;

/** True when a chat turn uses the cloud engine, model and tools. */
function chatRunsInCloud() {
  return runsInCloud(_meraProtocolStore.useMeraProtocolStore.getState());
}

/** Reactive `chatRunsInCloud()` for components. */
const useChatRunsInCloud = () => (0, _meraProtocolStore.useMeraProtocolStore)(runsInCloud);
exports.useChatRunsInCloud = useChatRunsInCloud;