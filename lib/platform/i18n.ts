// Stands in for the app's lib/i18n: the host's i18next instance (default export) and applyLanguage.
import type { i18n as I18n } from 'i18next';
import { forward, platform } from './index';

const i18n: I18n = forward('i18n', (host) => host.i18n);

/** Switches the interface language. A host without one only changes i18next's language. */
export function applyLanguage(lang: string): void {
  const host = platform('i18n');
  if (host.applyLanguage) host.applyLanguage(lang);
  else void host.i18n.changeLanguage(lang);
}

export default i18n;
