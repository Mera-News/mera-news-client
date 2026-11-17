import logger from '@/lib/logger';
import { sentryCalls } from '@/test/helpers';

function sent() {
  const { exception, context } = sentryCalls.exceptions[0];
  return { err: exception as Error, extra: context!.extra as Record<string, unknown> };
}

describe('captureException non-Error normalisation', () => {
  it('passes a real Error through untouched, no nonErrorThrow', () => {
    const e = new Error('boom');
    logger.captureException(e, { extra: { a: 1 } });
    const { err, extra } = sent();
    expect(err).toBe(e);
    expect(extra).toEqual({ a: 1 });
  });

  it('uses a string as-is', () => {
    logger.captureException('plain failure');
    const { err, extra } = sent();
    expect(err.message).toBe('plain failure');
    expect(extra.nonErrorThrow).toEqual({ type: 'string' });
  });

  it('derives message, name and code from an object', () => {
    logger.captureException({ name: 'SQLiteError', code: 'SQLITE_FULL', message: 'disk full', secret: 'x' });
    const { err, extra } = sent();
    expect(err.message).toBe('SQLiteError [SQLITE_FULL]: disk full');
    expect(err.name).toBe('SQLiteError');
    expect(extra.nonErrorThrow).toEqual({
      type: 'object',
      keys: ['name', 'code', 'message', 'secret'],
      code: 'SQLITE_FULL',
    });
  });

  it('falls back to bounded JSON for an object without a message', () => {
    logger.captureException({ a: 1, big: 'y'.repeat(2000) });
    const { err } = sent();
    expect(err.message.startsWith('{"a":1,"big":"yyy')).toBe(true);
    expect(err.message.length).toBe(500);
  });

  it('survives circular objects', () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    logger.captureException(o);
    expect(sent().err.message).toBe('{"a":1,"self":"[Circular]"}');
  });

  it('handles null and undefined', () => {
    logger.captureException(null);
    logger.captureException(undefined);
    expect((sentryCalls.exceptions[0].exception as Error).message).toBe('null');
    expect((sentryCalls.exceptions[1].exception as Error).message).toBe('undefined');
    expect(sentryCalls.exceptions[0].context!.extra!.nonErrorThrow).toEqual({ type: 'null' });
  });

  it('never throws on a hostile object', () => {
    const o = new Proxy({}, { ownKeys() { throw new Error('no'); }, get() { throw new Error('no'); } });
    expect(() => logger.captureException(o)).not.toThrow();
  });
});
