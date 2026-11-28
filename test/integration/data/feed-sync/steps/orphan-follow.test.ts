// A follow whose story write failed gets its followed-story row back at the next feed sync, and an
// unfollow retires the topic and drops the row in one write so it leaves no orphan.
jest.mock('@/lib/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    addBreadcrumb: jest.fn(),
  },
}));

import database from '@/lib/database';
import { persistAndLinkV2Suggestions } from '@/lib/database/services/article-suggestion-persist';
import * as trackedStoryService from '@/lib/database/services/tracked-story-service';
import { observeActive } from '@/lib/database/services/tracked-story-service';
import { reconcileTrackedStories } from '@/lib/scheduler/feed-sync/tracked-story-reconcile';
import { deleteTrackedStoryById, trackStoryWithProposal } from '@/lib/tracking/track-actions';
import type { FeedbackSubject } from '@/lib/tracking/feedback-subject';
import { firstValueFrom } from 'rxjs';
import { testHost } from '@/test/helpers';
import { art, cleanupFeedSync, resetFeedSyncMemory, spyOnExport } from './support';

beforeEach(resetFeedSyncMemory);
afterEach(() => {
  testHost.podCommand = undefined;
  cleanupFeedSync();
});

const subject: FeedbackSubject = {
  origin: 'suggestion',
  surface: 'for_you',
  articleId: 'seed',
  title: 'Seed',
  pubDate: new Date('2026-10-09T06:00:00.000Z').toISOString(),
  publicationName: 'Seed Pub',
};

const topics = () => database.get('topics').query().fetch() as Promise<any[]>;
const stories = () => database.get('tracked_stories').query().fetch() as Promise<any[]>;

async function mintWithFailingStoryWrite(text: string) {
  spyOnExport(trackedStoryService, 'trackStory').mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'));
  await expect(trackStoryWithProposal(subject, { label: text, searchText: text })).rejects.toThrow('x');
  const [topic] = await topics();
  expect(await stories()).toHaveLength(0);
  return topic.id as string;
}

async function storeMatch(id: string, topicId: string) {
  await persistAndLinkV2Suggestions([art(id)], new Map(), {
    matchedTopics: new Map([[id, [{ topicId, text: topicId }]]]),
  });
}

describe('orphaned follow', () => {
  it('is rebuilt by the next reconcile and grown from matched rows', async () => {
    const topicId = await mintWithFailingStoryWrite('gaza ceasefire');
    await storeMatch('m1', topicId);

    await reconcileTrackedStories();

    const [story] = await firstValueFrom(observeActive());
    expect(story.topicId).toBe(topicId);
    expect(story.memberArticleIds).toEqual(['m1']);
    expect(story.unseenCount).toBe(0);
  });

  it('is not rebuilt on a paired phone', async () => {
    await mintWithFailingStoryWrite('gaza ceasefire');
    testHost.podCommand = async () => undefined;

    await reconcileTrackedStories();

    expect(await stories()).toHaveLength(0);
  });

  it('is not rebuilt when its topic is bound to an ended story', async () => {
    const topicId = await mintWithFailingStoryWrite('gaza ceasefire');
    const row = await trackedStoryService.trackStory({
      articleId: '', title: 'x', originSurface: 'x', topicId, topicText: 'gaza ceasefire', llmHeadline: 'x', initialSnapshot: null,
    });
    await database.write(async () => {
      await row.update((m: any) => {
        m.status = 'ended';
      });
    });

    await reconcileTrackedStories();

    expect(await stories()).toHaveLength(1);
  });
});

describe('unfollow', () => {
  async function follow() {
    await trackStoryWithProposal(subject, { label: 'l', searchText: 'gaza ceasefire' });
    const [story] = await stories();
    return story.id as string;
  }

  it('retires the topic and drops the row in one write', async () => {
    const id = await follow();
    const twoStep = spyOnExport(trackedStoryService, 'untrackStory');

    await expect(deleteTrackedStoryById(id)).resolves.toBe(true);

    expect(twoStep).not.toHaveBeenCalled();
    expect(await stories()).toHaveLength(0);
    expect((await topics())[0].status).toBe('retired');
  });

  it('still deletes the row when the batch fails', async () => {
    const id = await follow();
    jest.spyOn(database, 'write').mockRejectedValueOnce(new Error('boom'));

    await expect(deleteTrackedStoryById(id)).resolves.toBe(true);

    expect(await stories()).toHaveLength(0);
    expect((await topics())[0].status).toBe('retired');
  });
});
