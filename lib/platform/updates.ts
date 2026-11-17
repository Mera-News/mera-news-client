// Stands in for 'expo-updates', which callers require lazily (`require('@/lib/platform/updates')`).
// `isEnabled` is read once, when this module first loads; a host's answer does not change while it runs.
// A host without over-the-air updates is never enabled and cannot reload.
import { platform } from './index';

export const isEnabled: boolean = platform('updates').updates?.isEnabled ?? false;

export function reloadAsync(): Promise<void> {
  const updates = platform('updates').updates;
  return updates ? updates.reloadAsync() : Promise.reject(new Error('The host cannot reload (lib/platform/updates)'));
}
