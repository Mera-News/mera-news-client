// Stands in for the on-device toolkit's entry ('@/lib/mera-protocol-toolkit' in the app): the
// phone's built-in text model and Kev. Calling it on a host without on-device models throws.
import type { DecisionRequest, DecisionResult } from 'llama.rn';
import { platform, type OnDeviceModel, type StructuredParams } from './index';
import type { InferParams, InferResult, TextEngine } from '../mera-protocol-toolkit/types';

export type { StructuredParams } from './index';
export type { InferenceLabel, InferParams, InferResult, TextEngine } from '../mera-protocol-toolkit/types';
export type { JsonSchema } from '../mera-protocol-toolkit/core/structured-json';

function model(): OnDeviceModel {
  const m = platform('on-device-model').onDeviceModel;
  if (!m) throw new Error('The host has no on-device models (lib/platform/on-device-model)');
  return m;
}

export function infer(params: InferParams): Promise<InferResult> {
  return model().infer(params);
}

export function inferStream(params: InferParams, signal?: AbortSignal): AsyncGenerator<string> {
  return model().inferStream(params, signal);
}

export function inferStructured<T = unknown>(params: StructuredParams): Promise<T> {
  return model().inferStructured<T>(params);
}

export function decide<R extends DecisionRequest>(request: R): Promise<DecisionResult<R['questions']>> {
  return model().decide(request);
}

export function contextSize(engine?: TextEngine): Promise<number | null> {
  return model().contextSize(engine);
}

export function resetContext(): Promise<void> {
  return model().resetContext();
}

export function getTextEngine(): Promise<TextEngine> {
  return model().getTextEngine();
}
