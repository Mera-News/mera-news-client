// Setup for the LLM, E2EE and transport tests: resets the module memory these tests leave behind.
//
// Required inside the hook, never imported at the top: setup files run before the test file, so a
// top-level import would load these modules (and the real logger under them) before a test file's
// jest.mock('@/lib/logger') could reach them.
beforeEach(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { _resetForTests: resetLimiter } = require('@/lib/llm/gateway-rate-limiter') as typeof import('@/lib/llm/gateway-rate-limiter');
  const { __resetRouterForTests } = require('@/lib/llm/router') as typeof import('@/lib/llm/router');
  const { __resetOnDeviceGateForTests } = require('@/lib/llm/on-device-gate') as typeof import('@/lib/llm/on-device-gate');
  const { clearAttestationCache } = require('@/lib/e2ee/e2ee-cache') as typeof import('@/lib/e2ee/e2ee-cache');
  const { __resetAppRestartForTests } = require('@/lib/app-restart') as typeof import('@/lib/app-restart');
  const { useChatPhaseStore } = require('@/lib/llm/chat-phase-store') as typeof import('@/lib/llm/chat-phase-store');
  /* eslint-enable @typescript-eslint/no-require-imports */
  resetLimiter();
  __resetRouterForTests();
  __resetOnDeviceGateForTests();
  clearAttestationCache();
  __resetAppRestartForTests();
  useChatPhaseStore.getState().reset();
});

export {};
