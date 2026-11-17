// Setup for the LLM, E2EE and transport tests: resets the module memory these tests leave behind.
import { __resetAppRestartForTests } from '@/lib/app-restart';
import { clearAttestationCache } from '@/lib/e2ee/e2ee-cache';
import { useChatPhaseStore } from '@/lib/llm/chat-phase-store';
import { _resetForTests as resetLimiter } from '@/lib/llm/gateway-rate-limiter';
import { __resetOnDeviceGateForTests } from '@/lib/llm/on-device-gate';
import { __resetRouterForTests } from '@/lib/llm/router';

beforeEach(() => {
  resetLimiter();
  __resetRouterForTests();
  __resetOnDeviceGateForTests();
  clearAttestationCache();
  __resetAppRestartForTests();
  useChatPhaseStore.getState().reset();
});
