"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.AccountService = void 0;
var _client = require("@apollo/client");
var _apolloClient = _interopRequireDefault(require("./platform/apollo-client"));
var _graphqlTypes = require("./generated/graphql-types");
var _logger = _interopRequireDefault(require("./logger"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const GET_USER_PERSONA = (0, _client.gql)`
  query GetUserPersona($userId: ID!) {
    userPersonaByUserId(userId: $userId) {
      _id
      userId
      preferredNotificationWindow
      notificationsEnabled
      expoPushToken
      onboardingStage
      blockedByLlm
      blockedByLlmReason
      language_codes
      llmWarningCount
      processingMode
      lastSuccessfulCompletedAt
      createdAt
      updatedAt
    }
  }
`;
const ALL_COUNTRIES = (0, _client.gql)`
  query AllCountries {
    allCountries
  }
`;
const UPDATE_NOTIFICATION_WINDOW = (0, _client.gql)`
  mutation UpdateNotificationWindow($input: UpdateNotificationWindowInput!) {
    updateNotificationWindow(input: $input) {
      _id
      preferredNotificationWindow
      notificationsEnabled
      expoPushToken
      onboardingStage
      createdAt
      updatedAt
    }
  }
`;
const UPDATE_EXPO_PUSH_TOKEN = (0, _client.gql)`
  mutation UpdateExpoPushToken($input: UpdateExpoPushTokenInput!) {
    updateExpoPushToken(input: $input) {
      _id
      preferredNotificationWindow
      notificationsEnabled
      expoPushToken
      onboardingStage
      createdAt
      updatedAt
    }
  }
`;
const DELETE_EXPO_PUSH_TOKEN = (0, _client.gql)`
  mutation DeleteExpoPushToken($input: DeleteExpoPushTokenInput!) {
    deleteExpoPushToken(input: $input) {
      _id
      preferredNotificationWindow
      notificationsEnabled
      expoPushToken
      onboardingStage
      createdAt
      updatedAt
    }
  }
`;
const ADVANCE_ONBOARDING_STAGE = (0, _client.gql)`
  mutation AdvanceOnboardingStage($userId: ID!, $stage: OnboardingStage!) {
    advanceOnboardingStage(userId: $userId, stage: $stage) {
      _id
      preferredNotificationWindow
      notificationsEnabled
      expoPushToken
      onboardingStage
      createdAt
      updatedAt
    }
  }
`;
const UPDATE_NOTIFICATIONS_ENABLED = (0, _client.gql)`
  mutation UpdateNotificationsEnabled($input: UpdateNotificationsEnabledInput!) {
    updateNotificationsEnabled(input: $input) {
      _id
      notificationsEnabled
      updatedAt
    }
  }
`;
const UPDATE_PROCESSING_MODE = (0, _client.gql)`
  mutation UpdateProcessingMode($input: UpdateProcessingModeInput!) {
    updateProcessingMode(input: $input) {
      _id
      processingMode
      updatedAt
    }
  }
`;
const UPDATE_USER_CONFIG = (0, _client.gql)`
  mutation UpdateUserConfig($input: UpdateUserConfigInput!) {
    updateUserConfig(input: $input) {
      _id
      language_codes
      updatedAt
    }
  }
`;

// Server-authoritative LLM warning. Increments llmWarningCount; at count >= 3
// also sets blockedByLlm + blockedByLlmReason. Returns the updated persona.
// Selects the full field set persistUserPersona needs so the local cache stays
// authoritative after a warning.
const ISSUE_LLM_WARNING = (0, _client.gql)`
  mutation IssueLlmWarning($input: IssueLlmWarningInput!) {
    issueLlmWarning(input: $input) {
      _id
      userId
      blockedByLlm
      blockedByLlmReason
      llmWarningCount
      processingMode
      onboardingStage
      notificationsEnabled
      preferredNotificationWindow
      language_codes
      createdAt
      updatedAt
    }
  }
`;
const REQUEST_UNBLOCK = (0, _client.gql)`
  mutation RequestUnblock($input: RequestUnblockInput!) {
    requestUnblock(input: $input) {
      _id
      userId
      feedback
      blockedReasonSnapshot
      status
      createdAt
      updatedAt
    }
  }
`;
const GET_UNBLOCK_REQUEST_STATUS = (0, _client.gql)`
  query UnblockRequestStatus($userId: ID!) {
    unblockRequestStatus(userId: $userId) {
      _id
      userId
      feedback
      blockedReasonSnapshot
      status
      createdAt
      updatedAt
    }
  }
`;

// Types

// --- LLM warning / unblock-request types (hand-written; no codegen dependency,
// server schema for these lands in parallel) ---

/** Single chat transcript entry sent with an unblock request (server input shape). */

// Account Service Class
class AccountService {
  /**
   * Get user persona data
   */
  static async getUserPersona(userId) {
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_USER_PERSONA,
        variables: {
          userId
        },
        fetchPolicy: 'network-only'
      });
      const userPersona = data?.userPersonaByUserId ?? null;
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'getUserPersona'
        },
        extra: {
          userId
        }
      });
      throw error;
    }
  }

  /**
   * Get the user's onboarding stage. Returns NOTIFICATIONS for missing
   * personas or errors — i.e. start from the beginning.
   */
  static async getOnboardingStage(userId) {
    try {
      const userPersona = await this.getUserPersona(userId);
      return userPersona?.onboardingStage ?? _graphqlTypes.OnboardingStage.Notifications;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'getOnboardingStage'
        },
        extra: {
          userId
        }
      });
      return _graphqlTypes.OnboardingStage.Notifications;
    }
  }

  /**
   * Update notification window
   */
  static async updateNotificationWindowMutation(userId, preferredNotificationWindow) {
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: UPDATE_NOTIFICATION_WINDOW,
        variables: {
          input: {
            userId,
            preferredNotificationWindow
          }
        }
      });
      const userPersona = data?.updateNotificationWindow;
      if (!userPersona) {
        throw new Error('Failed to update notification window - no data returned');
      }
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'updateNotificationWindowMutation'
        },
        extra: {
          userId,
          preferredNotificationWindow
        }
      });
      throw error;
    }
  }

  /**
   * Update expo push token
   */
  static async updateExpoPushTokenMutation(userId, expoPushToken) {
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: UPDATE_EXPO_PUSH_TOKEN,
        variables: {
          input: {
            userId,
            expoPushToken
          }
        }
      });
      const userPersona = data?.updateExpoPushToken;
      if (!userPersona) {
        throw new Error('Failed to update expo push token - no data returned');
      }
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'updateExpoPushTokenMutation'
        },
        extra: {
          userId
        }
      });
      throw error;
    }
  }

  /**
   * Delete expo push token
   */
  static async deleteExpoPushToken(userId) {
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: DELETE_EXPO_PUSH_TOKEN,
        variables: {
          input: {
            userId
          }
        }
      });
      const userPersona = data?.deleteExpoPushToken;
      if (!userPersona) {
        throw new Error('Failed to delete expo push token - no data returned');
      }
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'deleteExpoPushToken'
        },
        extra: {
          userId
        }
      });
      throw error;
    }
  }

  /**
   * Get all available countries (ISO Alpha-3 codes)
   */
  static async getAllCountries() {
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: ALL_COUNTRIES,
        fetchPolicy: 'network-only'
      });
      return data?.allCountries ?? [];
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'getAllCountries'
        }
      });
      throw error;
    }
  }

  /**
   * Update notification preferences
   */
  static async updateNotificationPreferences(userId, preferredNotificationWindow) {
    return this.updateNotificationWindowMutation(userId, preferredNotificationWindow);
  }

  /**
   * Advance the user's onboarding stage. Server enforces monotonic
   * progression — sending a lower or equal stage is a no-op.
   */
  static async advanceOnboardingStage(userId, stage) {
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: ADVANCE_ONBOARDING_STAGE,
        variables: {
          userId,
          stage
        }
      });
      const userPersona = data?.advanceOnboardingStage;
      if (!userPersona) {
        throw new Error('Failed to advance onboarding stage - no data returned');
      }
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'advanceOnboardingStage'
        },
        extra: {
          userId,
          stage
        }
      });
      throw error;
    }
  }

  /**
   * Toggle user-visible notifications (OS alerts, banners, sounds).
   * Independent of expoPushToken — silent result-ready pushes keep working
   * regardless of this flag.
   */
  static async updateNotificationsEnabled(userId, enabled) {
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: UPDATE_NOTIFICATIONS_ENABLED,
        variables: {
          input: {
            userId,
            enabled
          }
        }
      });
      const userPersona = data?.updateNotificationsEnabled;
      if (!userPersona) {
        throw new Error('Failed to update notifications enabled flag - no data returned');
      }
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'updateNotificationsEnabled'
        },
        extra: {
          userId,
          enabled
        }
      });
      throw error;
    }
  }

  /**
   * Switch the user's Mera Protocol processing mode between on-device and
   * cloud (E2EE) inference.
   */
  static async updateProcessingMode(userId, mode) {
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: UPDATE_PROCESSING_MODE,
        variables: {
          input: {
            userId,
            mode
          }
        }
      });
      const userPersona = data?.updateProcessingMode;
      if (!userPersona) {
        throw new Error('Failed to update processing mode - no data returned');
      }
      try {
        await _apolloClient.default.cache.reset();
      } catch (cacheError) {
        _logger.default.captureException(cacheError, {
          tags: {
            service: 'account-service',
            method: 'updateProcessingMode',
            type: 'cache-reset'
          }
        });
      }
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'updateProcessingMode'
        },
        extra: {
          userId,
          mode
        }
      });
      throw error;
    }
  }

  /**
   * Update user config (language_codes).
   * Used by on-device chat agent — these are settings, not PII.
   */
  static async updateUserConfig(userId, config) {
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: UPDATE_USER_CONFIG,
        variables: {
          input: {
            userId,
            ...config
          }
        }
      });
      const userPersona = data?.updateUserConfig;
      if (!userPersona) {
        throw new Error('Failed to update user config - no data returned');
      }
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'updateUserConfig'
        },
        extra: {
          userId
        }
      });
      throw error;
    }
  }

  /**
   * Issue a server-authoritative LLM warning. Increments llmWarningCount and,
   * at count >= 3, blocks the user. Returns the updated persona so callers can
   * refresh their local cache.
   */
  static async issueLlmWarning(userId, reason) {
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: ISSUE_LLM_WARNING,
        variables: {
          input: {
            userId,
            reason
          }
        }
      });
      const userPersona = data?.issueLlmWarning;
      if (!userPersona) {
        throw new Error('Failed to issue LLM warning - no data returned');
      }
      return userPersona;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'issueLlmWarning'
        },
        extra: {
          userId
        }
      });
      throw error;
    }
  }

  /**
   * Submit an unblock request with the user's feedback and the chat transcript
   * that led to the block. Server rejects (throws) if the user isn't blocked or
   * already has a PENDING request.
   */
  static async requestUnblock(params) {
    const {
      userId,
      feedback,
      chatHistory
    } = params;
    try {
      const {
        data
      } = await _apolloClient.default.mutate({
        mutation: REQUEST_UNBLOCK,
        variables: {
          input: {
            userId,
            feedback,
            chatHistory
          }
        }
      });
      const request = data?.requestUnblock;
      if (!request) {
        throw new Error('Failed to request unblock - no data returned');
      }
      return request;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'requestUnblock'
        },
        extra: {
          userId
        }
      });
      throw error;
    }
  }

  /**
   * Fetch the current PENDING unblock request for a user, or null if none.
   */
  static async getPendingUnblockRequest(userId) {
    try {
      const {
        data
      } = await _apolloClient.default.query({
        query: GET_UNBLOCK_REQUEST_STATUS,
        variables: {
          userId
        },
        fetchPolicy: 'network-only'
      });
      return data?.unblockRequestStatus ?? null;
    } catch (error) {
      _logger.default.captureException(error, {
        tags: {
          service: 'account-service',
          method: 'getPendingUnblockRequest'
        },
        extra: {
          userId
        }
      });
      throw error;
    }
  }
}
exports.AccountService = AccountService;
var _default = exports.default = AccountService;