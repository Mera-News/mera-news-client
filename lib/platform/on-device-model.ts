// Stands in for the on-device toolkit's entry ('@/lib/mera-protocol-toolkit' in the app): the
// phone's built-in text model and Kev. Every member is asynchronous, and on a host without
// on-device models each one fails as a rejected promise (a stream on its first read), never a
// synchronous throw: callers attach `.catch` to the call. resetContext is the exception: with no
// model there is no context, so it resolves.
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

export async function infer(params: InferParams): Promise<InferResult> {
  return model().infer(params);
}

export async function* inferStream(params: InferParams, signal?: AbortSignal): AsyncGenerator<string> {
  yield* model().inferStream(params, signal);
}

export async function inferStructured<T = unknown>(params: StructuredParams): Promise<T> {
  return model().inferStructured<T>(params);
}

export async function decide<R extends DecisionRequest>(request: R): Promise<DecisionResult<R['questions']>> {
  return model().decide(request);
}

export async function contextSize(engine?: TextEngine): Promise<number | null> {
  return model().contextSize(engine);
}

export async function resetContext(): Promise<void> {
  await platform('on-device-model').onDeviceModel?.resetContext();
}

export async function getTextEngine(): Promise<TextEngine> {
  return model().getTextEngine();
}
