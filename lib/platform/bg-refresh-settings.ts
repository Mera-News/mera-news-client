// Stands in for the app's lib/background/bg-refresh-settings. Does nothing on a host without
// background refresh.
import { platform } from './index';

export function recordForeground(at: number): Promise<void> {
  return platform('bg-refresh-settings').recordForeground?.(at) ?? Promise.resolve();
}
