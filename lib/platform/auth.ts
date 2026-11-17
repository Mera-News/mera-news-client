// Stands in for the app's lib/auth-client and lib/auth-failure-breaker: the Mera account session.
import { platform } from './index';

const auth = () => platform('auth').auth;

export function getJwtToken(): Promise<string | null> {
  return auth().getJwtToken();
}

export function invalidateJwtCache(): void {
  auth().invalidateJwtCache();
}

export const authClient = {
  getCookie(): string | null {
    return auth().getCookie();
  },
};

export function recordAuthFailure(): void {
  auth().recordAuthFailure();
}

export function onAppForeground(): void {
  auth().onAppForeground?.();
}

export function onNetworkReconnect(): void {
  auth().onNetworkReconnect?.();
}
