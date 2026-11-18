// The one registry of writers a paired phone sends to its pod, by name. The pod looks a name up here
// and runs the same function, with no sink set, so it writes locally there.
//
// Writers that are deliberately not registered:
// - recordOpen, recordPublicationVisit, markSeen, advanceSeenWatermark and the feed card state are
//   display marks. They write on the phone first and travel in one `marks` command (below).
// - setWeight in location-service is only called inside registered writers, which run on the pod.
// - replaceFact, removeEmptyFact, untrackStory, keepArticleForTrackedStory and removeArticleFeedback
//   are only called inside registered writers or by tasks the pod runs itself.
// - flushPendingDeletes is the pod's own timer closing the topic delete window.
// - generateMoreAndWait waits for a model job, which would hold a request open. A phone sends
//   generateMoreTopicsForFact and waits for the topics to arrive.
// - clearFeedCacheAndResync is split: the phone clears its own caches, then sends resync.
// - deleteNotification removes a row the phone keeps for itself.

import { AppScheduler } from '../scheduler/AppScheduler';
import { command } from './command';
import { commitFactChoices } from '../chat-tools/fact-commit';
import { addFact, deleteFact, deleteAllFacts, updateFact, setFactPlaces, markFactPlacesWrong, stopNewsForFact, removeFailedChatFact, patchMetadata } from '../database/services/fact-service';
import { nudgeFactWeight } from '../database/services/mutation-rails-service';
import { createTopics, retire, reactivate, setWeight } from '../database/services/topic-service';
import { deleteTopicWithDecline, undoPendingDelete, recordDecline, removeDecline } from '../database/services/topic-decline-service';
import { addSuppression, retireSuppression } from '../database/services/suppression-service';
import { deleteSetting, setSetting } from '../database/services/setting-service';
import { generateMoreTopicsForFact } from '../database/services/topic-planning-service';
import { retryTopicGeneration } from '../chat-tools/tool-handlers';
import { revertChange } from '../database/services/persona-change-log-service';
import { applyPersonaAction, applyPersonaActions } from '../database/services/persona-action-executor';
import { acceptProposal, rejectProposal } from '../database/services/hygiene-service';
import { addUserLocation, deleteUserLocation, setLocationWeightLogged } from '../database/services/location-persona-actions';
import { setRole } from '../database/services/location-service';
import { trackStoryWithProposal, deleteTrackedStoryById, disownStoryMember } from '../tracking/track-actions';
import { saveSuggestion, saveStandaloneArticle, moveSavedToList, deleteSavedSuggestion } from '../database/services/saved-article-suggestion-service';
import { commitSourcePrefPurge, setSourcePrefFromUi, revertSourcePrefChange } from '../database/services/publication-pref-ui-actions';
import { upsertSubscription, declinePublisher } from '../database/services/user-publication-subscription-service';
import { recordVerdictFeedback, recordFeedbackAnswer } from '../database/services/article-feedback-service';
import { clearAllImpressions, recordOpen } from '../database/services/story-impression-service';
import { clearAllVisits, recordPublicationVisit } from '../database/services/publication-visit-service';
import { advanceSeenWatermark, markSeen } from '../database/services/tracked-story-service';
import { FEED_CARD_STATE_SETTING_KEY, serializeCardState } from '../stores/feed-order-store';
import type { MarksBatch } from './marks';

export { COMMAND_REGISTRY_VERSION } from './command';

/** Asks the pod for a read. Answers `paused` without starting one while reads are paused. */
export const resync = command('resync', () => AppScheduler.trigger('feed-sync'));

/** Applies a phone's batch of display marks through the same writers, in the order they were made. */
async function applyMarks(batch: MarksBatch): Promise<void> {
  for (const open of batch.opens) await recordOpen(open);
  for (const visit of batch.visits) await recordPublicationVisit(visit);
  for (const id of batch.seen) await markSeen(id);
  for (const { id, ms } of batch.watermarks) await advanceSeenWatermark(id, ms);
  if (batch.cardState) await setSetting(FEED_CARD_STATE_SETTING_KEY, serializeCardState(batch.cardState as Parameters<typeof serializeCardState>[0]));
}
export const marks = command('marks', applyMarks);

export const COMMANDS = {
  acceptProposal,
  addFact,
  addSuppression,
  addUserLocation,
  applyPersonaAction,
  applyPersonaActions,
  clearAllImpressions,
  clearAllVisits,
  commitFactChoices,
  commitSourcePrefPurge,
  createTopics,
  declinePublisher,
  deleteAllFacts,
  deleteFact,
  deleteSavedSuggestion,
  deleteSetting,
  deleteTopicWithDecline,
  deleteTrackedStoryById,
  deleteUserLocation,
  disownStoryMember,
  generateMoreTopicsForFact,
  markFactPlacesWrong,
  marks,
  moveSavedToList,
  nudgeFactWeight,
  patchMetadata,
  reactivate,
  recordDecline,
  recordFeedbackAnswer,
  recordVerdictFeedback,
  rejectProposal,
  removeDecline,
  removeFailedChatFact,
  resync,
  retire,
  retireSuppression,
  retryTopicGeneration,
  revertChange,
  revertSourcePrefChange,
  saveStandaloneArticle,
  saveSuggestion,
  setFactPlaces,
  setLocationWeightLogged,
  setRole,
  setSetting,
  setSourcePrefFromUi,
  setWeight,
  stopNewsForFact,
  trackStoryWithProposal,
  undoPendingDelete,
  updateFact,
  upsertSubscription,
};
