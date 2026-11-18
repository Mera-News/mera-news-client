"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PlatformNotRegisteredError = void 0;
exports.__resetPlatformForTests = __resetPlatformForTests;
exports.forward = forward;
exports.platform = platform;
exports.registerPlatform = registerPlatform;
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

// --- Shapes (each one the subset of the module it replaces that the package uses) ----------------

/** A started span. Every member is optional: callers use them best-effort. */

/** Error reporting: the subset of @sentry/react-native the package uses. */

/** A missing item resolves null; a transient failure rejects. Callers rely on the difference. */

/** The phone's own models: the built-in text model and Kev, the decision model. */

// --- The host ----------------------------------------------------------------------------------

/**
 * Everything the client takes from its host. Members marked optional have a documented default in
 * their facade, so a host without that capability (a server has no haptics) leaves them out.
 */

// --- Registration --------------------------------------------------------------------------------

class PlatformNotRegisteredError extends Error {
  constructor(facade) {
    super(`lib/platform/${facade} was read before the host called registerPlatform`);
    this.facade = facade;
    this.name = 'PlatformNotRegisteredError';
  }
}
exports.PlatformNotRegisteredError = PlatformNotRegisteredError;
let current = null;
function registerPlatform(host) {
  if (current) throw new Error('registerPlatform was called twice');
  // Required only when a host brings a harness, so every other host loads exactly what it did before.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (host.harness) require("../harnesses/host-harness").applyHostHarness(host.harness);
  current = host;
  const g = globalThis;
  if (g.__DEV__ === undefined) g.__DEV__ = host.isDev ?? false;
}

/** The registered host. `facade` names the caller in the error when nothing is registered. */
function platform(facade) {
  if (!current) throw new PlatformNotRegisteredError(facade);
  return current;
}

/** An object whose every read goes to `pick(host)` at the time of the read. Methods stay bound. */
function forward(facade, pick) {
  return new Proxy({}, {
    get(_target, key) {
      const target = pick(platform(facade));
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(_target, key) {
      return Reflect.has(pick(platform(facade)), key);
    }
  });
}
function __resetPlatformForTests() {
  current = null;
}