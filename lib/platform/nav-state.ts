// Stands in for the app's lib/nav-state. A host with no screens is on no route.
import { platform } from './index';

export function getCurrentPathname(): string {
  return platform('nav-state').getCurrentPathname?.() ?? '';
}
