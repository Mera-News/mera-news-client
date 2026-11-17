// Stands in for 'react-native': AppState and DevSettings.
import { forward, platform } from './index';

export type { AppStateStatus } from './index';

export const AppState = forward('react-native', (host) => host.appState);

/** Dev-only reload. A host without one ignores the call. */
export const DevSettings = {
  reload(reason?: string): void {
    platform('react-native').devReload?.(reason);
  },
};
