// The five display writers stay local and each adds one entry to the mark batch.
import { defaultMarkBatch } from '@/lib/sync/marks';
import { recordOpen } from '@/lib/database/services/story-impression-service';
import { recordPublicationVisit } from '@/lib/database/services/publication-visit-service';
import { advanceSeenWatermark, markSeen } from '@/lib/database/services/tracked-story-service';
import { useFeedOrderStore } from '@/lib/stores/feed-order-store';
import { testHost } from '@/test/helpers';
import { seedCtx, useQueuedJobs, type Ctx } from './support';

let ctx: Ctx;
beforeEach(async () => {
  useQueuedJobs();
  ctx = await seedCtx();
  testHost.podCommand = async () => ({});
  defaultMarkBatch.takeBatch();
});

const taken = () => defaultMarkBatch.takeBatch().batch;

it('recordOpen adds one open', async () => {
  await recordOpen({ articleId: 'a1', surface: 'feed' });
  expect(taken()).toMatchObject({ opens: [{ articleId: 'a1', surface: 'feed' }], visits: [], seen: [], watermarks: [] });
});

it('recordPublicationVisit adds one visit', async () => {
  await recordPublicationVisit({ publicationName: 'Die Zeit', countryCode: 'DE', articleId: 'a1' });
  expect(taken()).toMatchObject({ visits: [{ publicationName: 'Die Zeit', countryCode: 'DE', articleId: 'a1' }], opens: [] });
});

it('a visit with no publication name writes and marks nothing', async () => {
  await recordPublicationVisit({ publicationName: ' ', countryCode: null });
  expect(taken()).toBeNull();
});

it('markSeen adds one seen id', async () => {
  await markSeen(ctx.storyId);
  expect(taken()).toMatchObject({ seen: [ctx.storyId] });
});

it('advanceSeenWatermark adds one watermark', async () => {
  await advanceSeenWatermark(ctx.storyId, 1_800_000_000_000);
  expect(taken()).toMatchObject({ watermarks: [{ id: ctx.storyId, ms: 1_800_000_000_000 }] });
});

it('a card state persist sets the card state, last value wins', async () => {
  useFeedOrderStore.setState({ hydrated: true, order: ['c1'], itemsById: { c1: { id: 'c1', suggestion: ctx.suggestion } as never }, cardStates: {} });
  useFeedOrderStore.getState().markViewed('c1', 1_800_000_000_000);
  useFeedOrderStore.getState().flushPersist();
  expect(taken()).toMatchObject({ cardState: { c1: { state: 'viewed' } } });
});
