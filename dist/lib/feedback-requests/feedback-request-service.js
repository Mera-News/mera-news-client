"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FEEDBACK_RESPONSE_MAX_CHARS = exports.FEEDBACK_REQUEST_CLOSED = void 0;
exports.fetchActiveFeedbackRequests = fetchActiveFeedbackRequests;
exports.submitFeedbackResponse = submitFeedbackResponse;
var _client = require("@apollo/client");
var _apolloClient = _interopRequireDefault(require("../platform/apollo-client"));
var _logger = _interopRequireDefault(require("../logger"));
var _publicationDisplayService = require("../publication-display-service");
var _networkStore = require("../stores/network-store");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// feedback-request-service: the two GraphQL calls behind in-app feedback
// requests (a question the Mera team asks every user for a limited time).
//
//   activeFeedbackRequests(locale): LIVE requests with endsAt > now, the
//     question already localized server-side (English fallback). Self-scoped:
//     `answered` is about the signed-in account, and the client never sends a
//     user id.
//   submitFeedbackResponse(input): one answer. A closed, ended or unknown
//     request is a GraphQL error with extensions.code FEEDBACK_REQUEST_CLOSED;
//     `alreadyAnswered: true` is a success ("you already answered").
//
// Both are `no-cache` (asking again is the point) and `noSyncStatus` (neither
// is part of the feed sync, so a failure must never paint "sync failed" on
// the feed). The Apollo error link owns Sentry capture; this file only
// breadcrumbs, the same contract as article-service.
//
// Nothing about showing, opening or dismissing a request ever goes to the
// server: the only thing sent is the answer the reader chose to submit.

const FEEDBACK_REQUEST_CLOSED = exports.FEEDBACK_REQUEST_CLOSED = 'FEEDBACK_REQUEST_CLOSED';

/** Server-side bounds on an answer (trimmed). The modal enforces the max. */
const FEEDBACK_RESPONSE_MAX_CHARS = exports.FEEDBACK_RESPONSE_MAX_CHARS = 2000;
const ACTIVE_FEEDBACK_REQUESTS = (0, _client.gql)`
  query ActiveFeedbackRequests($locale: String!) {
    activeFeedbackRequests(locale: $locale) {
      id
      question
      endsAt
      createdAt
      answered
    }
  }
`;
const SUBMIT_FEEDBACK_RESPONSE = (0, _client.gql)`
  mutation SubmitFeedbackResponse($input: SubmitFeedbackResponseInput!) {
    submitFeedbackResponse(input: $input) {
      ok
      alreadyAnswered
    }
  }
`;
/** GraphQL error codes on a rejection (Apollo 4 `errors`). */
function graphQLErrorCodes(err) {
  const list = err.errors;
  if (!Array.isArray(list)) return [];
  return list.map(e => e?.extensions?.code).filter(c => typeof c === 'string');
}

/** Raw device link only, never `isOnline()` (a latch about Mera's own health).
 *  `=== false`: an unknown link is not offline. */
function deviceOffline() {
  return _networkStore.useNetworkStore.getState().isConnected === false;
}
function breadcrumb(method, extra) {
  _logger.default.addBreadcrumb(`[feedback-request] ${method} failed`, 'feedback-request', {
    method,
    ...extra
  }, 'warning');
}
function toRequest(row) {
  if (!row || typeof row.id !== 'string' || row.id === '') return null;
  if (typeof row.question !== 'string' || row.question.trim() === '') return null;
  const endsAt = Date.parse(String(row.endsAt));
  if (!Number.isFinite(endsAt)) return null;
  return {
    id: row.id,
    question: row.question,
    endsAt,
    answered: row.answered === true
  };
}

/**
 * The live requests, in the app language (mapped to the server's locale list:
 * sent as-is, `zh-Hans` would silently get English). Never throws.
 */
async function fetchActiveFeedbackRequests(appLanguage) {
  const variables = {
    locale: (0, _publicationDisplayService.serverLocaleFor)(appLanguage)
  };
  try {
    const {
      data
    } = await _apolloClient.default.query({
      query: ACTIVE_FEEDBACK_REQUESTS,
      variables,
      fetchPolicy: 'no-cache',
      context: {
        noSyncStatus: true
      }
    });
    const requests = (data?.activeFeedbackRequests ?? []).map(toRequest).filter(r => r !== null);
    return {
      ok: true,
      requests
    };
  } catch (err) {
    breadcrumb('fetchActiveFeedbackRequests', {
      codes: graphQLErrorCodes(err)
    });
    return {
      ok: false,
      offline: deviceOffline()
    };
  }
}

/**
 * Send one answer. `text` is trimmed here; an empty answer never reaches the
 * network. Never throws.
 */
async function submitFeedbackResponse(feedbackRequestId, text) {
  const trimmed = text.trim().slice(0, FEEDBACK_RESPONSE_MAX_CHARS);
  if (!trimmed) return {
    status: 'error',
    offline: false
  };
  const variables = {
    input: {
      feedbackRequestId,
      text: trimmed
    }
  };
  try {
    const {
      data
    } = await _apolloClient.default.mutate({
      mutation: SUBMIT_FEEDBACK_RESPONSE,
      variables,
      fetchPolicy: 'no-cache',
      // A closed question is an outcome this screen shows ("This question has
      // closed"), not a fault: a breadcrumb in the error link, no Sentry event.
      context: {
        noSyncStatus: true,
        expectedErrorCodes: [FEEDBACK_REQUEST_CLOSED]
      }
    });
    const result = data?.submitFeedbackResponse;
    if (!result) {
      breadcrumb('submitFeedbackResponse', {
        reason: 'empty-result'
      });
      return {
        status: 'error',
        offline: false
      };
    }
    if (result.alreadyAnswered) return {
      status: 'ok',
      alreadyAnswered: true
    };
    if (!result.ok) {
      breadcrumb('submitFeedbackResponse', {
        reason: 'not-ok'
      });
      return {
        status: 'error',
        offline: false
      };
    }
    return {
      status: 'ok',
      alreadyAnswered: false
    };
  } catch (err) {
    const codes = graphQLErrorCodes(err);
    if (codes.includes(FEEDBACK_REQUEST_CLOSED)) return {
      status: 'closed'
    };
    breadcrumb('submitFeedbackResponse', {
      codes
    });
    return {
      status: 'error',
      offline: deviceOffline()
    };
  }
}