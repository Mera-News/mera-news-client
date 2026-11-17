// Stands in for 'expo-keep-awake'. A host that never sleeps leaves keepAwake out: both calls do nothing.
import { platform } from './index';

export function activateKeepAwakeAsync(tag?: string): Promise<void> {
  return platform('keep-awake').keepAwake?.activateKeepAwakeAsync(tag) ?? Promise.resolve();
}

export function deactivateKeepAwake(tag?: string): Promise<void> {
  return Promise.resolve(platform('keep-awake').keepAwake?.deactivateKeepAwake(tag));
}
