// Before a host registers, every facade read fails loudly and names the facade; none falls back.
import type { PlatformNotRegisteredError } from '@/lib/platform';

function readWithoutHost(read: () => unknown): PlatformNotRegisteredError {
  let thrown: unknown;
  jest.isolateModules(() => {
    try {
      read();
    } catch (err) {
      thrown = err;
    }
  });
  // The class is loaded again inside the isolated registry, so match on name.
  expect((thrown as Error)?.name).toBe('PlatformNotRegisteredError');
  return thrown as PlatformNotRegisteredError;
}

test('loading the endpoints config before registration throws, naming the env facade', () => {
  const err = readWithoutHost(() => require('@/lib/config/endpoints'));
  expect(err.facade).toBe('env');
});

test('reporting an error before registration throws, naming the sentry facade', () => {
  const err = readWithoutHost(() => require('@/lib/logger').default.captureException(new Error('x')));
  expect(err.facade).toBe('sentry');
});
