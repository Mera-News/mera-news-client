// A writer that returns models: the pod answers ids, the caller gets the rows the sink applied.
import { commandReturns } from '@/lib/sync/command';
import { COMMANDS } from '@/lib/sync/commands';
import { createTopics } from '@/lib/database/services/topic-service';
import { addUserLocation } from '@/lib/database/services/location-persona-actions';
import { addSuppression } from '@/lib/database/services/suppression-service';
import database from '@/lib/database';
import { testHost } from '@/test/helpers';

type Row = Record<string, unknown>;
const insert = (table: string, rows: Row[]) =>
  database.write(async () => {
    for (const row of rows) {
      await database.get(table).create((r: any) => {
        Object.assign(r._raw, row);
      });
    }
  });

it('createTopics answers the models of the ids the pod sent, in order', async () => {
  testHost.podCommand = async () => {
    await insert('topics', [
      { id: 'pod-b', text: 'b', normalized_text: 'b', weight: 0.5, status: 'active' },
      { id: 'pod-a', text: 'a', normalized_text: 'a', weight: 0.5, status: 'active' },
    ]);
    return { ids: ['pod-b', 'pod-a'] };
  };

  const topics = await createTopics([
    { text: 'a', weight: 0.5 },
    { text: 'b', weight: 0.5 },
  ]);

  expect(topics.map((t) => t.id)).toEqual(['pod-b', 'pod-a']);
});

it('addUserLocation answers the result with the location replaced by the model', async () => {
  testHost.podCommand = async () => {
    await insert('locations', [{ id: 'pod-loc', city: 'Oslo', country_code: 'NO', role: 'home', weight: 1 }]);
    return { location: { id: 'pod-loc' }, updated: false };
  };

  const result = await addUserLocation({ countryCode: 'NO', city: 'Oslo', role: 'home' });

  expect(result.updated).toBe(false);
  expect(result.location.id).toBe('pod-loc');
  expect(result.location.city).toBe('Oslo');
});

describe('commandReturns', () => {
  it('tells the pod how each result turns into ids', () => {
    expect(commandReturns('createTopics')).toEqual({ table: 'topics', many: true });
    expect(commandReturns('addUserLocation')).toEqual({ table: 'locations', path: 'location' });
    expect(commandReturns('addSuppression')).toEqual({ table: 'persona_suppressions' });
    expect(commandReturns('deleteFact')).toBeUndefined();
  });

  it('knows exactly the writers that return models', () => {
    const withReturns = Object.keys(COMMANDS).filter((n) => commandReturns(n));
    expect(withReturns.sort()).toEqual(['addSuppression', 'addUserLocation', 'createTopics', 'upsertSubscription']);
  });
});

it('a writer with no sink still returns its own models', async () => {
  const model = await addSuppression({ pattern: 'x', strength: 0.5, source: 'chat' });
  expect(model.pattern).toBe('x');
});
