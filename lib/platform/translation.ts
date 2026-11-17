// Stands in for the app's lib/translation-service and lib/translation-queue (the OS translator).
// A host without one can translate into nothing, and the other calls do nothing.
import { platform, type LateTranslationSink } from './index';

export type { LateTranslationSink } from './index';

export function canTranslateIntoLanguage(targetLangCode: string, osMajorOverride?: number): boolean {
  return platform('translation').canTranslateIntoLanguage?.(targetLangCode, osMajorOverride) ?? false;
}

export function clearTranslationFailuresFor(targetLangCode: string): void {
  platform('translation').clearTranslationFailuresFor?.(targetLangCode);
}

export function setLateTranslationSink(sink: LateTranslationSink | null): void {
  platform('translation').setLateTranslationSink?.(sink);
}

/** Drops the host's queued translations for the old language. Without a host queue there is no epoch: 0. */
export function bumpTranslationEpoch(reason?: string): number {
  return platform('translation').bumpTranslationEpoch?.(reason) ?? 0;
}
