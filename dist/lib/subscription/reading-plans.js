"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.__setReadingPlansForTests = __setReadingPlansForTests;
exports.fetchReadingPlans = fetchReadingPlans;
exports.getReadingPlans = exports.formatMb = void 0;
exports.planRatio = planRatio;
exports.useReadingPlans = void 0;
var _client = require("@apollo/client");
var _zustand = require("zustand");
var _apolloClient = _interopRequireDefault(require("../platform/apollo-client"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Every plan's daily cloud reading, as the server enforces it (owner: the app
// holds no static plan size or usage ratio anywhere). Copy that states a size
// or a ratio reads it from here and drops the line while it is unknown.
//
// Its own quiet query, like GET_USER_READING: a server without `readingPlans`
// fails only this operation, and the copy simply shows no numbers.

const GET_READING_PLANS = (0, _client.gql)`
  query GetReadingPlans {
    userBilling {
      readingPlans {
        starter
        individual
        professional
      }
    }
  }
`;
const useReadingPlansStore = (0, _zustand.create)(() => ({
  plans: null
}));

/** Fetch the plan sizes into the store. Quiet on failure; keeps the last answer. */
async function fetchReadingPlans() {
  try {
    const {
      data
    } = await _apolloClient.default.query({
      query: GET_READING_PLANS,
      fetchPolicy: 'no-cache',
      context: {
        noSyncStatus: true,
        expectedErrorCodes: ['GRAPHQL_VALIDATION_FAILED']
      }
    });
    const plans = data?.userBilling?.readingPlans ?? null;
    if (plans) useReadingPlansStore.setState({
      plans
    });
    return plans;
  } catch {
    return null;
  }
}
const getReadingPlans = () => useReadingPlansStore.getState().plans;
exports.getReadingPlans = getReadingPlans;
const useReadingPlans = () => useReadingPlansStore(s => s.plans);

/** How many times the bigger plan reads the smaller one, or null when it is not a real step up. */
exports.useReadingPlans = useReadingPlans;
function planRatio(bigger, smaller) {
  const r = Math.round(bigger / smaller);
  return Number.isFinite(r) && r >= 2 ? r : null;
}

/** Decimal megabytes as copy writes them: 4, 20, 2.5. */
const formatMb = bytes => `${Number((bytes / 1_000_000).toFixed(1))} MB`;
exports.formatMb = formatMb;
function __setReadingPlansForTests(plans) {
  useReadingPlansStore.setState({
    plans
  });
}