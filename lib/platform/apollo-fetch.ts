// Stands in for the app's lib/apollo-fetch. A host without request timeouts never reports one.
import { platform } from './index';

export function isRequestTimeoutError(error: unknown): boolean {
  return platform('apollo-fetch').isRequestTimeoutError?.(error) ?? false;
}
