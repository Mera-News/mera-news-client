// Stands in for '@sentry/react-native' (`import * as Sentry from '@/lib/platform/sentry'`).
import { platform, type Breadcrumb, type CaptureContext, type Scope, type Span } from './index';

export type { Breadcrumb, CaptureContext, Scope, SeverityLevel, Span } from './index';

const sentry = () => platform('sentry').sentry;

export function captureException(exception: unknown, context?: CaptureContext): string {
  return sentry().captureException(exception, context);
}

export function captureMessage(message: string, context?: CaptureContext): string {
  return sentry().captureMessage(message, context);
}

export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  sentry().addBreadcrumb(breadcrumb);
}

export function setUser(user: { id: string; email?: string; username?: string } | null): void {
  sentry().setUser(user);
}

export function setTag(key: string, value: string): void {
  sentry().setTag(key, value);
}

export function setExtra(key: string, value: unknown): void {
  sentry().setExtra(key, value);
}

export function startInactiveSpan(options: { name: string; op?: string; attributes?: Record<string, unknown> }): Span {
  return sentry().startInactiveSpan(options);
}

export function withScope(callback: (scope: Scope) => void): void {
  sentry().withScope(callback);
}
