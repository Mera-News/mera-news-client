// The host's own steps inside the client's flows. Each does nothing when the host leaves it out.
import { platform } from './index';

/** Restores the host's own state; hydrateAllStores awaits it. May reject. */
export function hydrateHostState(): Promise<void> {
  return platform('host').hydrateHostState?.() ?? Promise.resolve();
}

/** Clears the host's own state; clearAllStores awaits it last. */
export function resetHostState(): Promise<void> {
  return platform('host').resetHostState?.() ?? Promise.resolve();
}

/** Development only: keeps a copy of a request the client sent, for reading by hand. */
export function devDump(fileName: string, text: string): void {
  platform('host').devDump?.(fileName, text);
}
