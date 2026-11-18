"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.COMMANDS = void 0;
Object.defineProperty(exports, "COMMAND_REGISTRY_VERSION", {
  enumerable: true,
  get: function () {
    return _command.COMMAND_REGISTRY_VERSION;
  }
});
exports.resync = void 0;
var _AppScheduler = require("../scheduler/AppScheduler");
var _command = require("./command");
var _factCommit = require("../chat-tools/fact-commit");
var _factService = require("../database/services/fact-service");
var _mutationRailsService = require("../database/services/mutation-rails-service");
var _topicService = require("../database/services/topic-service");
var _topicDeclineService = require("../database/services/topic-decline-service");
var _suppressionService = require("../database/services/suppression-service");
var _settingService = require("../database/services/setting-service");
var _topicPlanningService = require("../database/services/topic-planning-service");
var _toolHandlers = require("../chat-tools/tool-handlers");
var _personaChangeLogService = require("../database/services/persona-change-log-service");
var _personaActionExecutor = require("../database/services/persona-action-executor");
var _hygieneService = require("../database/services/hygiene-service");
var _locationPersonaActions = require("../database/services/location-persona-actions");
var _locationService = require("../database/services/location-service");
var _trackActions = require("../tracking/track-actions");
var _savedArticleSuggestionService = require("../database/services/saved-article-suggestion-service");
var _publicationPrefUiActions = require("../database/services/publication-pref-ui-actions");
var _userPublicationSubscriptionService = require("../database/services/user-publication-subscription-service");
var _articleFeedbackService = require("../database/services/article-feedback-service");
var _storyImpressionService = require("../database/services/story-impression-service");
var _publicationVisitService = require("../database/services/publication-visit-service");
// The one registry of writers a paired phone sends to its pod, by name. The pod looks a name up here
// and runs the same function, with no sink set, so it writes locally there.
//
// Writers that are deliberately not registered:
// - recordOpen, recordPublicationVisit, markSeen, advanceSeenWatermark and the feed card state are
//   display marks. They write here first and travel in the batch of marks (lib/sync/marks).
// - setWeight in location-service is only called inside registered writers, which run on the pod.
// - replaceFact, removeEmptyFact, untrackStory, keepArticleForTrackedStory and removeArticleFeedback
//   are only called inside registered writers or by tasks the pod runs itself.
// - flushPendingDeletes is the pod's own timer closing the topic delete window.
// - generateMoreAndWait waits for a model job, which would hold a request open. A phone sends
//   generateMoreTopicsForFact and waits for the topics to arrive.
// - clearFeedCacheAndResync is split: the phone clears its own caches, then sends resync.
// - deleteNotification removes a row the phone keeps for itself.

/** Asks the pod for a read. Answers `paused` without starting one while reads are paused. */
const resync = exports.resync = (0, _command.command)('resync', () => _AppScheduler.AppScheduler.trigger('feed-sync'));
const COMMANDS = exports.COMMANDS = {
  acceptProposal: _hygieneService.acceptProposal,
  addFact: _factService.addFact,
  addSuppression: _suppressionService.addSuppression,
  addUserLocation: _locationPersonaActions.addUserLocation,
  applyPersonaAction: _personaActionExecutor.applyPersonaAction,
  applyPersonaActions: _personaActionExecutor.applyPersonaActions,
  clearAllImpressions: _storyImpressionService.clearAllImpressions,
  clearAllVisits: _publicationVisitService.clearAllVisits,
  commitFactChoices: _factCommit.commitFactChoices,
  commitSourcePrefPurge: _publicationPrefUiActions.commitSourcePrefPurge,
  createTopics: _topicService.createTopics,
  declinePublisher: _userPublicationSubscriptionService.declinePublisher,
  deleteAllFacts: _factService.deleteAllFacts,
  deleteFact: _factService.deleteFact,
  deleteSavedSuggestion: _savedArticleSuggestionService.deleteSavedSuggestion,
  deleteSetting: _settingService.deleteSetting,
  deleteTopicWithDecline: _topicDeclineService.deleteTopicWithDecline,
  deleteTrackedStoryById: _trackActions.deleteTrackedStoryById,
  deleteUserLocation: _locationPersonaActions.deleteUserLocation,
  disownStoryMember: _trackActions.disownStoryMember,
  generateMoreTopicsForFact: _topicPlanningService.generateMoreTopicsForFact,
  markFactPlacesWrong: _factService.markFactPlacesWrong,
  moveSavedToList: _savedArticleSuggestionService.moveSavedToList,
  nudgeFactWeight: _mutationRailsService.nudgeFactWeight,
  patchMetadata: _factService.patchMetadata,
  reactivate: _topicService.reactivate,
  recordDecline: _topicDeclineService.recordDecline,
  recordFeedbackAnswer: _articleFeedbackService.recordFeedbackAnswer,
  recordVerdictFeedback: _articleFeedbackService.recordVerdictFeedback,
  rejectProposal: _hygieneService.rejectProposal,
  removeDecline: _topicDeclineService.removeDecline,
  removeFailedChatFact: _factService.removeFailedChatFact,
  resync,
  retire: _topicService.retire,
  retireSuppression: _suppressionService.retireSuppression,
  retryTopicGeneration: _toolHandlers.retryTopicGeneration,
  revertChange: _personaChangeLogService.revertChange,
  revertSourcePrefChange: _publicationPrefUiActions.revertSourcePrefChange,
  saveStandaloneArticle: _savedArticleSuggestionService.saveStandaloneArticle,
  saveSuggestion: _savedArticleSuggestionService.saveSuggestion,
  setFactPlaces: _factService.setFactPlaces,
  setLocationWeightLogged: _locationPersonaActions.setLocationWeightLogged,
  setRole: _locationService.setRole,
  setSetting: _settingService.setSetting,
  setSourcePrefFromUi: _publicationPrefUiActions.setSourcePrefFromUi,
  setWeight: _topicService.setWeight,
  stopNewsForFact: _factService.stopNewsForFact,
  trackStoryWithProposal: _trackActions.trackStoryWithProposal,
  undoPendingDelete: _topicDeclineService.undoPendingDelete,
  updateFact: _factService.updateFact,
  upsertSubscription: _userPublicationSubscriptionService.upsertSubscription
};