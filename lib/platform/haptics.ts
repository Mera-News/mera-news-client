// Stands in for the app's lib/haptics. Does nothing on a host without haptics.
import { platform } from './index';

export function hapticLight(): Promise<void> {
  return platform('haptics').hapticLight?.() ?? Promise.resolve();
}
