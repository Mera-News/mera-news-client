"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NonRetryableError = void 0;
exports.createCancellationError = createCancellationError;
exports.isCancellationError = isCancellationError;
exports.isNativeFetchCancel = isNativeFetchCancel;
exports.isNonRetryableError = isNonRetryableError;
exports.isSessionRefusedError = isSessionRefusedError;
exports.isThrottleError = isThrottleError;
exports.isUnauthenticatedError = isUnauthenticatedError;
exports.withRetry = withRetry;
var _errors = require("@apollo/client/errors");
var _logger = _interopRequireDefault(require("../logger"));
var _sleep = require("./sleep");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// GraphQL error codes that are permanent client-side failures — retrying them
// just multiplies the request storm while the server keeps rejecting. e.g. a
// 247-topic request that trips the server's BAD_USER_INPUT "too many topics"
// guard will never succeed by retrying.
const NON_RETRYABLE_GRAPHQL_CODES = new Set(['BAD_USER_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'GRAPHQL_VALIDATION_FAILED']);

/**
 * Marks an error as permanently non-retryable so the scheduler skips its
 * maxAttempts reschedule (and `withRetry` skips its backoff loop). Carries the
 * originating error as `cause` for reporting.
 */
class NonRetryableError extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = void 0;
    this.name = 'NonRetryableError';
    this.cause = cause;
  }
}
exports.NonRetryableError = NonRetryableError;
/**
 * True when `error` is a permanent client-side failure that must never be
 * retried: a GraphQL/Apollo error carrying a non-retryable extensions.code
 * (directly or in a nested `errors[]`), or a network/ServerError with a 4xx
 * HTTP status.
 */
function isNonRetryableError(error) {
  if (error instanceof NonRetryableError) return true;
  if (!error || typeof error !== 'object') return false;

  // Apollo v4 wraps GraphQL errors in CombinedGraphQLErrors.
  if (_errors.CombinedGraphQLErrors.is(error)) {
    return error.errors.some(e => NON_RETRYABLE_GRAPHQL_CODES.has(e.extensions?.code ?? ''));
  }

  // A bare GraphQL error, or a wrapper carrying a nested `errors[]` array.
  const direct = error.extensions?.code;
  if (direct && NON_RETRYABLE_GRAPHQL_CODES.has(direct)) return true;
  const nested = error.errors;
  if (Array.isArray(nested) && nested.some(e => NON_RETRYABLE_GRAPHQL_CODES.has(e?.extensions?.code ?? ''))) {
    return true;
  }

  // Network / ServerError with a 4xx status code — deterministic client error.
  const ne = error;
  const status = ne.statusCode ?? ne.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * True when `error` is an HTTP 408 / 429 (read exactly like `isNonRetryableError`
 * reads the status). Owner rule: throttles are retried by the scheduler with its
 * growing delay, never by `withRetry`'s tight inner loop, which would re-hit a
 * server that is shedding load.
 */
function isThrottleError(error) {
  if (!error || typeof error !== 'object') return false;
  const ne = error;
  const status = ne.statusCode ?? ne.response?.status;
  return status === 408 || status === 429;
}

/**
 * True when `error` is a 401 / UNAUTHENTICATED, in any of the shapes Apollo
 * Client v4 surfaces it in (GraphQL extensions, network error, wrapped network
 * error).
 *
 * ONE DEFINITION, DELIBERATELY. The 401 reporting rule has to be identical at
 * every catch site — the Apollo error link, `ArticleService.reportQueryError`
 * and the scheduler runner all suppress on it — and a second copy that drifts
 * is enough to re-open the duplicate-event storm this predicate exists to stop.
 * It lives beside `isNonRetryableError` because the two answer the same kind of
 * question about the same error shapes, and because `lib/utils/retry` is
 * dependency-light: importing it must never drag Apollo's client instance into
 * a module (the scheduler runner) that has no business constructing one.
 */
function isUnauthenticatedError(error) {
  if (_errors.CombinedGraphQLErrors.is(error)) {
    return error.errors.some(e => {
      const ext = e.extensions;
      return ext?.code === 'UNAUTHENTICATED' || ext?.statusCode === 401;
    });
  }
  const ne = error;
  const status = ne?.statusCode ?? ne?.response?.status ?? ne?.networkError?.statusCode;
  return status === 401;
}

/** True when the server refused this session: a 401 or a 403, in the shapes above. */
function isSessionRefusedError(error) {
  if (isUnauthenticatedError(error)) return true;
  if (_errors.CombinedGraphQLErrors.is(error)) {
    return error.errors.some(e => {
      const ext = e.extensions;
      return ext?.code === 'FORBIDDEN' || ext?.statusCode === 403;
    });
  }
  const ne = error;
  return (ne?.statusCode ?? ne?.response?.status ?? ne?.networkError?.statusCode) === 403;
}
async function withRetry(op, signal, maxRetries = 3, tag = '[retry]') {
  let delay = 100;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw createCancellationError();
    try {
      return await op();
    } catch (err) {
      if (signal?.aborted) throw createCancellationError();
      // Never retry a permanent client-side failure — rethrow immediately so
      // the caller (and scheduler) can treat it as terminal.
      if (isNonRetryableError(err)) throw err;
      if (attempt === maxRetries) throw err;
      _logger.default.warn(`${tag} retry ${attempt + 1}/${maxRetries}`);
      await (0, _sleep.sleep)(delay);
      delay *= 2;
    }
  }
  throw new Error(`${tag} withRetry: unexpected exit`);
}

/**
 * The one way to signal "this operation was CANCELLED", as opposed to "this
 * operation failed".
 *
 * `name` is 'AbortError' so it matches the same predicate the Apollo error link
 * already uses to keep a screen unmount from faking a server outage
 * (`isCancellation` in lib/apollo-client.ts); `message` stays the literal
 * 'aborted' that `lib/algorithms/transient-error.ts` substring-matches on, so both
 * existing readers keep working unchanged.
 *
 * A cancellation is not a defect: nobody can act on "the user navigated away
 * mid-request", and reporting it spends an issue on a non-event (Sentry
 * MERA-APP-6W). `logger.captureException` drops these, which is why every abort
 * throw in the app should come from here rather than `new Error('aborted')`.
 */
function createCancellationError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

/** True when `error` represents a cancellation rather than a failure. */
function isCancellationError(error) {
  return error?.name === 'AbortError';
}

/**
 * expo/fetch's native cancel: a plain Error, not an AbortError. Kept apart from
 * isCancellationError, whose name-only check the scoring pipeline's deadline logic reads.
 * shortcut: English iOS texts only (iOS localizes them, no code exposed); a new wording
 * needs adding here.
 */
function isNativeFetchCancel(error) {
  const message = error?.message;
  return typeof message === 'string' && /^fetch failed: (fetch request has been )?cancell?ed\.?$/i.test(message);
}