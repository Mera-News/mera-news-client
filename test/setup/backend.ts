// The in-process backend every integration test runs against: MSW serving the mock backend, the
// in-memory database, and a reset of all of it before each test.

// WatermelonDB's WorkQueue starts each queued DB operation with setTimeout(0)
// (Database/WorkQueue.js, `_executeNext` after `this._queue.shift()`). On the strict fake clock
// alone, concurrent writes stall until a test moves time, and a write still queued at test end
// wedges every later resetDatabase. On real timers alone, a test that drives with bare
// jest.advanceTimersByTimeAsync no longer runs DB work in step. So that one call is set on both
// clocks and runs once, on whichever fires first. Every other timer is untouched. If an upgrade
// changes that line, setup throws instead of silently falling back to the wedge.
jest.doMock('@nozbe/watermelondb/Database/WorkQueue', () => {
  const path = require('path');
  const file = require.resolve('@nozbe/watermelondb/Database/WorkQueue');
  const source: string = require('fs').readFileSync(file, 'utf8');
  const call = /setTimeout\((function \(\) \{\s*return _this2\._executeNext\(\);\s*\}), 0\)/g;
  const found = source.match(call)?.length ?? 0;
  if (found !== 1) {
    const { version } = require('@nozbe/watermelondb/package.json');
    throw new Error(
      `test/setup/backend.ts: expected one setTimeout(_executeNext, 0) in ${file} ` +
        `(@nozbe/watermelondb ${version}), found ${found}. Re-check the WorkQueue patch.`,
    );
  }
  const { setTimeout: realSetTimeout } = jest.requireActual('timers');
  const bothClocks = (fn: () => void) => {
    let ran = false;
    const once = () => {
      if (!ran) {
        ran = true;
        fn();
      }
    };
    realSetTimeout(once, 0);
    return setTimeout(once, 0);
  };
  const mod = { exports: {} };
  const load = (p: string) => jest.requireActual(p.startsWith('.') ? path.join(path.dirname(file), p) : p);
  const patched = source.replace(call, '__bothClocks($1)');
  new Function('exports', 'require', 'module', '__bothClocks', patched)(mod.exports, load, mod, bothClocks);
  return mod.exports;
});

// Console stays quiet; a test that cares spies on it.
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
};

// MSW listens before any test file loads, so a module that keeps a reference to globalThis.fetch
// at import still goes through it. An unhandled request is recorded and fails the test.
const { server, unhandled } = require('../helpers/msw') as typeof import('../helpers/msw');
const { assertNoGatewayViolations } = require('../helpers/gateway') as typeof import('../helpers/gateway');
const { resetScenario } = require('../mock-backend/scenario') as typeof import('../mock-backend/scenario');
const { resetAuthState } = require('../mock-backend/auth') as typeof import('../mock-backend/auth');
const { resetGatewayState } = require('../mock-backend/gateway/handlers') as typeof import('../mock-backend/gateway/handlers');
const { resetDatabase } = require('../helpers/db') as typeof import('../helpers/db');

server.listen({ onUnhandledRequest: (req) => void unhandled.push(`${req.method} ${req.url}`) });

afterEach(() => {
  server.resetHandlers();
  jest.useRealTimers();
  const u = unhandled.splice(0);
  // E2EE contract breaks (cleartext tool keys, wrong headers, undecryptable envelopes) fail the
  // test; tests that plant one on purpose drain it with takeGatewayViolations().
  assertNoGatewayViolations();
  if (u.length) {
    throw new Error('Unhandled requests (add a handler or a server.use override):\n' + u.join('\n'));
  }
});

afterAll(() => server.close());

beforeEach(async () => {
  resetScenario();
  resetAuthState();
  resetGatewayState();
  await resetDatabase();
});
