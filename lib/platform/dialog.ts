// Stands in for the app's lib/dialog. A host without dialogs answers as if the reader declined.
import { platform, type DialogOptions } from './index';

export type { DialogOptions } from './index';

export function showDialog(options: DialogOptions): Promise<boolean> {
  return platform('dialog').showDialog?.(options) ?? Promise.resolve(false);
}
