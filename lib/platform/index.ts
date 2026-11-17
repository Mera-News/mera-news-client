// The platform the client runs on, given once by its host (the mobile app, a server, a test).
//
// Code in this package never imports a native module. Each file in this folder stands in for one
// module the logic used to import directly (react-native, expo-*, Sentry, or an app module such as
// auth-client) and exports the same names with the same shapes, read from the host at call time.
// Moving a file into the package therefore changes its import specifier and nothing else:
//
//   import { AppState } from 'react-native'   ->   import { AppState } from '@/lib/platform/react-native'
//
// The host calls registerPlatform before it imports anything else from the package: several
// modules read the platform while they load (the database, config/endpoints). A read before
// registration throws PlatformNotRegisteredError naming the facade that was read.

import type { ApolloClient } from '@apollo/client';
import type { DatabaseAdapter } from '@nozbe/watermelondb/adapters/type';
import type { SQLiteAdapterOptions } from '@nozbe/watermelondb/adapters/sqlite/type';
import type { DecisionRequest, DecisionResult } from 'llama.rn';
import type { i18n as I18n } from 'i18next';
import type { InferParams, InferResult, TextEngine } from '../mera-protocol-toolkit/types';
import type { JsonSchema } from '../mera-protocol-toolkit/core/structured-json';

// --- Shapes (each one the subset of the module it replaces that the package uses) ----------------

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface AppStateLike {
  currentState: AppStateStatus | null;
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

/** A started span. Every member is optional: callers use them best-effort. */
export interface Span {
  setAttribute?(key: string, value: unknown): unknown;
  setStatus?(status: unknown): unknown;
  end?(): void;
}

export interface Scope {
  setTag(key: string, value: string): unknown;
  setLevel(level: SeverityLevel): unknown;
}

export interface CaptureContext {
  level?: SeverityLevel;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
}

export interface Breadcrumb {
  message?: string;
  category?: string;
  data?: Record<string, unknown>;
  level?: SeverityLevel;
}

/** Error reporting: the subset of @sentry/react-native the package uses. */
export interface Telemetry {
  captureException(exception: unknown, context?: CaptureContext): string;
  captureMessage(message: string, context?: CaptureContext): string;
  addBreadcrumb(breadcrumb: Breadcrumb): void;
  setUser(user: { id: string; email?: string; username?: string } | null): void;
  setTag(key: string, value: string): void;
  setExtra(key: string, value: unknown): void;
  startInactiveSpan(options: { name: string; op?: string; attributes?: Record<string, unknown> }): Span;
  withScope(callback: (scope: Scope) => void): void;
}

export interface NetInfoState {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
  type?: string;
}

export interface NetInfoLike {
  fetch(): Promise<NetInfoState>;
  addEventListener(listener: (state: NetInfoState) => void): () => void;
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** A missing item resolves null; a transient failure rejects. Callers rely on the difference. */
export interface SecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface Locale {
  languageTag: string;
  languageCode: string | null;
  regionCode: string | null;
}

export interface Auth {
  getJwtToken(): Promise<string | null>;
  invalidateJwtCache(): void;
  /** The session cookie, read synchronously from local storage. */
  getCookie(): string | null;
  /** Reports a 401 to the host's session breaker. */
  recordAuthFailure(): void;
  onAppForeground?(): void;
  onNetworkReconnect?(): void;
}

export interface NotifiedToastOptions {
  type: string;
  source: string;
  title: string;
  body: string;
  /** Stored on the row only (MaterialIcons name); the toast's glyph comes from `type`. */
  icon?: string;
  context?: Record<string, unknown>;
  actions?: { id: string; labelKey?: string; label?: string }[];
  /** Passed through to `notify()`: no second inbox row of the same type and source today (UTC). */
  dedupeDaily?: boolean;
  /** Passed through to `notify()`: row types this row replaces. */
  replaces?: string[];
  /** false: the toast leaves with the default fade, not the flight to the inbox. */
  fly?: boolean;
}

export interface DialogOptions {
  title: string;
  body?: string;
  /** A red consequence line under the body. */
  warning?: string;
  confirmLabel: string;
  /** Omit for a one-button notice. */
  cancelLabel?: string;
  destructive?: boolean;
}

export type StructuredParams = {
  system: string;
  prompt: string;
  /** The reply's shape. Its root is an object or an array. */
  schema: JsonSchema;
  temperature?: number;
  maxTokens?: number;
  /** The engine the prompt was built for; a phone only ever has one. */
  engine?: TextEngine;
  label?: InferParams['label'];
};

/** The phone's own models: the built-in text model and Kev, the decision model. */
export interface OnDeviceModel {
  infer(params: InferParams): Promise<InferResult>;
  inferStream(params: InferParams, signal?: AbortSignal): AsyncGenerator<string>;
  inferStructured<T = unknown>(params: StructuredParams): Promise<T>;
  decide<R extends DecisionRequest>(request: R): Promise<DecisionResult<R['questions']>>;
  contextSize(engine?: TextEngine): Promise<number | null>;
  resetContext(): Promise<void>;
  getTextEngine(): Promise<TextEngine>;
}

export type KeychainMigrationOutcome = 'migrated' | 'already-done' | 'not-needed' | 'failed';
export type LateTranslationSink = (text: string, targetLangCode: string, translated: string) => void;

// --- The host ----------------------------------------------------------------------------------

/**
 * Everything the client takes from its host. Members marked optional have a documented default in
 * their facade, so a host without that capability (a server has no haptics) leaves them out.
 */
export interface PlatformHost {
  /** Sets the `__DEV__` global when the host has not defined it. */
  isDev?: boolean;
  /** Build-time configuration, read by name (`EXPO_PUBLIC_*` in the app). */
  env: Readonly<Record<string, string | undefined>>;

  appState: AppStateLike;
  devReload?(reason?: string): void;
  keepAwake?: {
    activateKeepAwakeAsync(tag?: string): Promise<void>;
    deactivateKeepAwake(tag?: string): Promise<void> | void;
  };
  updates?: { readonly isEnabled: boolean; reloadAsync(): Promise<void> };
  getCurrentPathname?(): string;
  captureSpot?(): unknown;

  sentry: Telemetry;
  submitFeatureRequest?(title: string, summary: string): boolean;
  devDump?(fileName: string, text: string): void;

  fetch: typeof globalThis.fetch;
  isRequestTimeoutError?(error: unknown): boolean;
  netInfo?: NetInfoLike;

  asyncStorage: KeyValueStore;
  secureStore: SecureStore;
  getLocales(): Locale[];

  auth: Auth;
  /**
   * The GraphQL client the package's services query. The services only leave a breadcrumb when a
   * query fails, so the host's client owns error handling, or a failure goes silent:
   * - capture every GraphQL error, except a code listed in the operation's
   *   `context.expectedErrorCodes`, which gets a breadcrumb only;
   * - unless the operation sets `context.noSyncStatus`, report a failure to the feed's sync status
   *   while the app is in the foreground;
   * - report a 401 to the host's session breaker (the same signal as `auth.recordAuthFailure`).
   */
  apolloClient: ApolloClient;
  createDatabaseAdapter(options: SQLiteAdapterOptions): DatabaseAdapter;

  i18n: I18n;
  applyLanguage?(lang: string): void;
  canTranslateIntoLanguage?(targetLangCode: string, osMajorOverride?: number): boolean;
  clearTranslationFailuresFor?(targetLangCode: string): void;
  setLateTranslationSink?(sink: LateTranslationSink | null): void;
  bumpTranslationEpoch?(reason?: string): number;

  /** Shows the toast for an inbox row the package already wrote (row is null when the write failed). */
  showNotifiedToast?(row: unknown, opts: NotifiedToastOptions): void;
  showDialog?(options: DialogOptions): Promise<boolean>;
  hapticLight?(): Promise<void>;

  onDeviceModel?: OnDeviceModel;

  recordForeground?(at: number): Promise<void>;
  runKeychainAccessibilityMigration?(): Promise<KeychainMigrationOutcome>;
  /** Restores the host's own state; awaited inside hydrateAllStores. May reject. */
  hydrateHostState?(): Promise<void>;
  /** Clears the host's own state; awaited last in clearAllStores. */
  resetHostState?(): Promise<void>;
}

// --- Registration --------------------------------------------------------------------------------

export class PlatformNotRegisteredError extends Error {
  constructor(readonly facade: string) {
    super(`lib/platform/${facade} was read before the host called registerPlatform`);
    this.name = 'PlatformNotRegisteredError';
  }
}

let current: PlatformHost | null = null;

export function registerPlatform(host: PlatformHost): void {
  if (current) throw new Error('registerPlatform was called twice');
  current = host;
  const g = globalThis as { __DEV__?: boolean };
  if (g.__DEV__ === undefined) g.__DEV__ = host.isDev ?? false;
}

/** The registered host. `facade` names the caller in the error when nothing is registered. */
export function platform(facade: string): PlatformHost {
  if (!current) throw new PlatformNotRegisteredError(facade);
  return current;
}

/** An object whose every read goes to `pick(host)` at the time of the read. Methods stay bound. */
export function forward<T extends object>(facade: string, pick: (host: PlatformHost) => T): T {
  return new Proxy({} as T, {
    get(_target, key) {
      const target = pick(platform(facade));
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(_target, key) {
      return Reflect.has(pick(platform(facade)), key);
    },
  });
}

export function __resetPlatformForTests(): void {
  current = null;
}
