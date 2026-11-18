// Shared by the command tests: one seeded profile, one recorded call per registered writer, a row dump.
import { firstValueFrom } from 'rxjs';
import database from '@/lib/database';
import { addFact } from '@/lib/database/services/fact-service';
import { addUserLocation } from '@/lib/database/services/location-persona-actions';
import { createTopics } from '@/lib/database/services/topic-service';
import { addSuppression } from '@/lib/database/services/suppression-service';
import { applyPersonaAction } from '@/lib/database/services/persona-action-executor';
import { recordDecline } from '@/lib/database/services/topic-decline-service';
import { observeActive } from '@/lib/database/services/tracked-story-service';
import { upsertSubscription } from '@/lib/database/services/user-publication-subscription-service';
import { trackStoryWithProposal } from '@/lib/tracking/track-actions';
import { ACTION_NAMES } from '@/lib/news-harness/persona-management/action-names';
import { ProcessingMode } from '@/lib/generated/graphql-types';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
import type { ForYouSuggestion } from '@/lib/stores/for-you-store';
import type { NewsArticle } from '@/lib/generated/graphql-types';
import { freshId, landSuggestion } from '../../data/services/retention/support';

export interface Ctx {
  factId: string;
  topicId: string;
  suppressionId: string;
  subscriptionId: string;
  locationId: string;
  declineId: string;
  changeLogId: string;
  storyId: string;
  suggestion: ForYouSuggestion;
}

/** Background jobs are queued, not run, so no call reaches a model. */
export function useQueuedJobs(): void {
  useMeraProtocolStore.setState({ processingMode: ProcessingMode.OnDevice });
}

export async function seedCtx(): Promise<Ctx> {
  const fact = await addFact('Follows chess');
  const [topic] = await createTopics([{ factId: fact.id, text: 'chess news', weight: 0.5 }]);
  const suppression = await addSuppression({ pattern: 'crypto', strength: 0.5, source: 'chat' });
  const subscription = await upsertSubscription({ publisherId: 'seed', publisherName: 'Seed Pub', countryCode: 'NL', sourceNames: ['Seed Pub'] });
  const { location } = await addUserLocation({ countryCode: 'NO', city: 'Oslo', role: 'home' });
  const decline = await recordDecline('golf news', fact.id);
  const change = await applyPersonaAction({ action_type: ACTION_NAMES.SET_TOPIC_WEIGHT, topicId: topic.id, delta: -0.1 }, 'user');
  const suggestion = await landSuggestion(freshId('seed'));
  await trackStoryWithProposal(subject(suggestion.articleId), { label: 'Chess', searchText: 'chess openings' });
  const story = (await firstValueFrom(observeActive()))[0];
  return {
    factId: fact.id,
    topicId: topic.id,
    suppressionId: suppression.id,
    subscriptionId: subscription.id,
    locationId: location.id,
    declineId: decline.id,
    changeLogId: change.changeLogId!,
    storyId: story.id,
    suggestion,
  };
}

const subject = (articleId: string) => ({
  origin: 'suggestion' as const,
  surface: 'for_you' as const,
  articleId,
  title: `Seed ${articleId}`,
  pubDate: '2026-10-09T10:00:00.000Z',
  publicationName: 'Seed Pub',
});

const standalone = (id: string): NewsArticle =>
  ({
    _id: id,
    article_url: `https://example.com/${id}`,
    title: 'Standalone headline',
    title_en: 'Standalone headline',
    publicationSource: { _id: 'pub-1', publication_name: 'Die Zeit', country_code: 'DE' },
  }) as unknown as NewsArticle;

/** One call per registered writer, from the shapes its existing tests use. */
export const CALLS: Record<string, (c: Ctx) => unknown[]> = {
  commitFactChoices: () => [[{ statement: 'Plays the cello' }], {}],
  addFact: () => ['Lives in Bergen'],
  deleteFact: (c) => [c.factId],
  deleteAllFacts: () => [],
  updateFact: (c) => [c.factId, { statement: 'Follows chess openings' }],
  setFactPlaces: (c) => [c.factId, ['Oslo'], 'user'],
  markFactPlacesWrong: (c) => [c.factId],
  marks: (c) => [{
    opens: [{ articleId: c.suggestion.articleId, surface: 'feed' }],
    visits: [{ publicationName: 'Seed Pub' }],
    seen: [c.storyId],
    watermarks: [{ id: c.storyId, ms: 1_791_547_206_000 }],
    cardState: { [c.suggestion.articleId]: { state: 'viewed', at: 1_791_547_206_000 } },
  }],
  stopNewsForFact: (c) => [c.factId],
  removeFailedChatFact: (c) => [c.factId, 'Follows chess', { inOwnJob: true }],
  patchMetadata: (c) => [c.factId, { interests: ['chess'] }],
  nudgeFactWeight: (c) => [c.factId, 0.1, 'nudge'],
  retire: (c) => [c.topicId],
  reactivate: (c) => [c.topicId],
  setWeight: (c) => [c.topicId, 0.8],
  deleteTopicWithDecline: (c) => [c.topicId],
  undoPendingDelete: (c) => [c.topicId],
  recordDecline: (c) => ['tennis news', c.factId],
  removeDecline: (c) => [c.declineId],
  addSuppression: () => [{ pattern: 'celebrity gossip', strength: 0.9, source: 'chat' }],
  retireSuppression: (c) => [c.suppressionId],
  generateMoreTopicsForFact: (c) => [c.factId, 'Follows chess', { count: 3 }],
  retryTopicGeneration: (c) => [c.factId, 'Follows chess'],
  revertChange: (c) => [c.changeLogId],
  applyPersonaAction: (c) => [{ action_type: ACTION_NAMES.DISCARD_FACT, factId: c.factId }, 'user'],
  applyPersonaActions: (c) => [[{ action_type: ACTION_NAMES.SET_TOPIC_WEIGHT, topicId: c.topicId, delta: 0.1 }], 'user'],
  acceptProposal: () => ['no-such-proposal'],
  rejectProposal: () => ['no-such-proposal'],
  deleteUserLocation: (c) => [{ id: c.locationId, city: 'Oslo', countryCode: 'NO', role: 'home' }],
  setLocationWeightLogged: (c) => [c.locationId, 0.7],
  setRole: (c) => [c.locationId, 'work'],
  trackStoryWithProposal: () => [subject(freshId('track')), { label: 'Tennis', searchText: 'tennis rankings' }],
  deleteTrackedStoryById: (c) => [c.storyId],
  disownStoryMember: (c) => [c.storyId, c.suggestion.articleId],
  saveSuggestion: (c) => [c.suggestion],
  saveStandaloneArticle: () => [standalone(freshId('standalone'))],
  moveSavedToList: (c) => [c.suggestion._id, 'archive'],
  deleteSavedSuggestion: (c) => [c.suggestion._id],
  setSourcePrefFromUi: () => [{ kind: 'publication', publicationName: 'Die Zeit' }, 'prioritised'],
  revertSourcePrefChange: () => [{ applied: true, changeLogIds: [] }],
  upsertSubscription: () => [{ publisherId: 'pub1', publisherName: 'Het Parool', countryCode: 'NL', sourceNames: ['Het Parool'] }],
  declinePublisher: () => [{ publisherId: 'pub2', publisherName: 'The Next Web', countryCode: 'GLOBAL' }],
  recordVerdictFeedback: (c) => [{ articleId: c.suggestion.articleId, sentiment: 'like', title: 'T' }],
  recordFeedbackAnswer: (c) => [c.suggestion.articleId, { leafId: 'wrong_place', path: ['a'], cause: 'config' }, { applied: false }],
  clearAllImpressions: () => [],
  clearAllVisits: () => [],
  resync: () => [],
  createTopics: () => [[{ text: 'tennis rankings', weight: 0.5 }]],
  addUserLocation: () => [{ countryCode: 'SE', city: 'Malmo', role: 'work' }],
  commitSourcePrefPurge: () => ['no-such-change'],
  setSetting: () => ['app_language', 'nl'],
  deleteSetting: () => ['app_language'],
};

const EPOCH_MS = 1e12;

/** Every table's rows. */
export async function dumpRows(): Promise<Record<string, unknown[]>> {
  const tables: Record<string, unknown[]> = {};
  for (const name of Object.keys(database.collections.map).sort()) {
    const rows = await database.get(name).query().fetch();
    tables[name] = rows.map((r) => ({ ...(r._raw as unknown as Record<string, unknown>) }));
  }
  return tables;
}

/** Replaces each row id (and each of `ids`, which a deleted row no longer shows) by its position and epoch times by T, so two runs of one call compare equal. */
export function mask(value: unknown, ids: string[] = []): string {
  // A model is read as its raw row, and the bookkeeping columns are dropped.
  const plain = JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (key === '_changed' || key === '_status') return undefined;
      if (typeof v === 'number' && v >= EPOCH_MS) return 'T';
      return v && typeof v === 'object' && '_raw' in v ? v._raw : v;
    }),
  );
  const found = new Set<string>(ids);
  const collect = (v: unknown, key?: string): void => {
    if (key === 'id' && typeof v === 'string') found.add(v);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) collect(x, k);
  };
  collect(plain);
  let text = JSON.stringify(plain);
  [...found].forEach((id, i) => (text = text.split(id).join(`#${i}`)));
  return text.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, 'T');
}
