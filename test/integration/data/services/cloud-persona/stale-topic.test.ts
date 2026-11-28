// stale_topic end to end: rows that reach the Feed stamp their fact-made topics, data cleanup
// stamps before its sweep deletes them, and the weekly hygiene sweep proposes removing a fact-made
// topic only after nothing from it reached the Feed for the whole window since stamping began.
// Real in-memory DB, the real analyzer and the gateway mock for the sweep's sanity audit.
import '@/lib/scheduler/tasks/data-cleanup-task';

import database from '@/lib/database';
import type TopicModel from '@/lib/database/models/Topic';
import { MIN_FACTS_FOR_SWEEP, getPendingProposals, runHygieneSweep } from '@/lib/database/services/hygiene-service';
import { getSetting } from '@/lib/database/services/setting-service';
import { stampTopicSignalsFromFeed, TOPIC_SIGNAL_SINCE_KEY } from '@/lib/database/services/topic-signal-service';
import { HYGIENE_THRESHOLDS } from '@/lib/news-harness/persona-management/fact-hygiene';
import { AppScheduler } from '@/lib/scheduler/AppScheduler';
import type { TaskDefinition } from '@/lib/scheduler/scheduler-types';
import { testHost } from '@/test/helpers/platform-host';
import { advanceUntilDone, mockGateway, server, useFakeClock } from '@/test/helpers';
import { article, seed, toComplete, matched } from '../suggestions/support';
import {
  DAY,
  T0,
  quietLogger,
  resetCloudPersonaMemory,
  sanityModel,
  seedFact,
  seedPersona,
  seedTopics,
  spyOnNotifications,
} from './support';

const topicRow = (id: string) => database.get<TopicModel>('topics').find(id);
const signalOf = async (id: string) => (await topicRow(id)).lastSignalAt;

/** A stored row retrieved by `topic`, scored to `relevance` with a note, at the current clock. */
async function feedRow(id: string, topic: { id: string; text: string }, relevance = 0.8) {
  await seed([article(id)], { topics: { [id]: [matched(topic)] } });
  await toComplete(id, relevance);
}

let logs: ReturnType<typeof quietLogger>;
let notified: ReturnType<typeof spyOnNotifications>;

beforeEach(() => {
  logs = quietLogger();
  notified = spyOnNotifications();
  resetCloudPersonaMemory();
  useFakeClock(T0);
  server.use(...mockGateway(sanityModel(() => false)));
});
afterEach(() => {
  notified.restore();
  logs.restore();
  delete (testHost as { podCommand?: unknown }).podCommand;
});

describe('stamping from the Feed', () => {
  it('stamps a fact-made topic whose row reached the Feed, and nothing else', async () => {
    const { topics: [onFeed, belowGate] } = await seedFact('From India', ['India visa rules', 'India double-tax treaties']);
    const [followed] = await seedTopics(null, [{ text: 'India visa rules', provenance: 'tracked', weight: 0.85 }]);
    const { topics: [added] } = await seedFact('Lives in Amsterdam', [{ text: 'India visa rules', provenance: 'user' }]);

    await feedRow('a1', onFeed);
    await feedRow('a2', belowGate, 0.38);

    expect(await stampTopicSignalsFromFeed(T0)).toBe(1);
    expect(await signalOf(onFeed.id)).toBe(T0);
    expect(await signalOf(belowGate.id)).toBeNull();
    expect(await signalOf(followed.id)).toBeNull();
    expect(await signalOf(added.id)).toBeNull();
    expect(await getSetting(TOPIC_SIGNAL_SINCE_KEY)).toBe(String(T0));
  });

  it('stamps through a followed story that shares the text, and only moves forward', async () => {
    const { topics: [own] } = await seedFact('From India', ['India visa rules']);
    const [followed] = await seedTopics(null, [{ text: 'India visa rules', provenance: 'tracked', weight: 0.85 }]);
    await feedRow('a1', followed);

    await stampTopicSignalsFromFeed(T0);
    expect(await signalOf(own.id)).toBe(T0);

    // A later run over an older row leaves the newer stamp, and the start marker stays put.
    jest.setSystemTime(T0 - DAY);
    await feedRow('a0', own);
    jest.setSystemTime(T0 + DAY);
    expect(await stampTopicSignalsFromFeed(T0 + DAY)).toBe(0);
    expect(await signalOf(own.id)).toBe(T0);
    expect(await getSetting(TOPIC_SIGNAL_SINCE_KEY)).toBe(String(T0));
  });

  it('does nothing on a phone paired with a server', async () => {
    const { topics: [own] } = await seedFact('From India', ['India visa rules']);
    await feedRow('a1', own);
    (testHost as { podCommand?: unknown }).podCommand = async () => undefined;

    expect(await stampTopicSignalsFromFeed(T0)).toBe(0);
    expect(await signalOf(own.id)).toBeNull();
    expect(await getSetting(TOPIC_SIGNAL_SINCE_KEY)).toBeNull();
  });

  it('data cleanup stamps a row before its sweep deletes it', async () => {
    const { topics: [own] } = await seedFact('From India', ['India visa rules']);
    jest.setSystemTime(T0 - 3 * DAY);
    await feedRow('old', own, 0.6);
    jest.setSystemTime(T0);
    const task = (AppScheduler as unknown as { tasks: Map<string, TaskDefinition<unknown>> }).tasks.get('data-cleanup')!;

    await advanceUntilDone(task.handler(undefined, { log: () => undefined } as never) as Promise<unknown>);

    expect(await database.get('article_suggestions').query().fetchCount()).toBe(0);
    expect(await signalOf(own.id)).toBe(T0 - 3 * DAY);
  });
});

describe('the stale_topic proposal', () => {
  const window = HYGIENE_THRESHOLDS.staleTopicIdleMs;
  const sweep = (now: number) => advanceUntilDone(runHygieneSweep({ now, force: true }));
  const staleOnes = async () => (await getPendingProposals()).filter((p) => p.kind === 'stale_topic');

  async function persona() {
    await seedPersona(MIN_FACTS_FOR_SWEEP);
    jest.setSystemTime(T0 - 100 * DAY);
    const india = await seedFact('From India', ['India visa rules', 'India double-tax treaties']);
    const [followed] = await seedTopics(null, [{ text: 'GTA 6', provenance: 'tracked', weight: 0.85 }]);
    jest.setSystemTime(T0);
    return { live: india.topics[0], quiet: india.topics[1], followed };
  }

  it('is never proposed for the weeks before stamping began', async () => {
    await persona();
    await sweep(T0);
    expect(await staleOnes()).toEqual([]);
  });

  it('names the quiet fact-made topic, its fact and the weeks, once the window has passed with nothing on the Feed', async () => {
    const { live, quiet } = await persona();
    await sweep(T0);

    const later = T0 + window + DAY;
    jest.setSystemTime(later - DAY);
    await feedRow('fresh', live);
    jest.setSystemTime(later);
    await sweep(later);

    const out = await staleOnes();
    expect(out.map((p) => p.targetTopicIds)).toEqual([[quiet.id]]);
    expect(out[0].subject).toEqual({ facts: ['From India'], topics: ['India double-tax treaties'], idleWeeks: 6 });
  });
});
