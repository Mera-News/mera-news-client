// Stands in for 'expo-localization'.
import { platform, type Locale } from './index';

export type { Locale } from './index';

export function getLocales(): Locale[] {
  return platform('localization').getLocales();
}
