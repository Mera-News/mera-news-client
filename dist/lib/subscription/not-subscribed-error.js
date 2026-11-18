"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.isNotSubscribedError = isNotSubscribedError;
var _errors = require("@apollo/client/errors");
var _httpStatusCodes = require("http-status-codes");
// Recognises the server's "active subscription required" (HTTP 402) response
// across the shapes Apollo Client v4 surfaces it in. The GraphQL service maps a
// NotSubscribedException to a GraphQL error with extensions
// `{ code: 'PAYMENT_REQUIRED', statusCode: 402 }` (graphql-exception.filter.ts).
// Older/network paths may instead carry a top-level/network 402. We accept all
// of them in one place so the error-link and the route gate can't drift.

/** True when `error` is the server's 402 "not subscribed" signal, in any shape. */
function isNotSubscribedError(error) {
  if (_errors.CombinedGraphQLErrors.is(error)) {
    return error.errors.some(e => {
      const ext = e.extensions;
      return ext?.code === 'PAYMENT_REQUIRED' || ext?.code === 'NOT_SUBSCRIBED' || ext?.statusCode === _httpStatusCodes.StatusCodes.PAYMENT_REQUIRED || ext?.exception?.name === 'NotSubscribedException' || typeof e.message === 'string' && e.message.includes('NotSubscribedException');
    });
  }
  const ne = error;
  const status = ne?.statusCode ?? ne?.response?.status ?? ne?.networkError?.statusCode;
  return status === _httpStatusCodes.StatusCodes.PAYMENT_REQUIRED;
}