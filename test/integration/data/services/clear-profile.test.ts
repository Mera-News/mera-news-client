// Clear profile's cascade: the bulk delete takes each fact's topics, so an emptied profile really is
// empty to the launch rule and to retrieval.
import { addFact, deleteAllFacts, getFacts, hasAnyFacts } from '@/lib/database/services/fact-service';
import { addUserLocation } from '@/lib/database/services/location-persona-actions';
import { getAll as getLocations, upsertLocation } from '@/lib/database/services/location-service';
import { countActiveTopicsIncludingStaged, createTopics, getActive } from '@/lib/database/services/topic-service';

const seedFactWithTopics = async (statement: string, texts: string[]) => {
  const fact = await addFact(statement);
  await createTopics(texts.map((text) => ({ text, factId: fact.id, weight: 1, status: 'active', provenance: 'llm' })));
};

// The launch rule itself (lib/navigation/startup-tab) stays in the app; these are the reads it makes.
it('takes every fact and the topics they own, leaving nothing the launch rule counts', async () => {
  await seedFactWithTopics('I follow racing', ['formula 1', 'motogp']);
  await seedFactWithTopics('Works as a nurse', ['nursing pay']);
  expect(await hasAnyFacts()).toBe(true);

  await deleteAllFacts();

  expect(await getFacts()).toEqual([]);
  expect(await countActiveTopicsIncludingStaged()).toBe(0);
  expect(await hasAnyFacts()).toBe(false);
  expect(await getLocations()).toEqual([]);
});

it('keeps a followed story, which no fact owns', async () => {
  await seedFactWithTopics('I follow racing', ['formula 1']);
  await createTopics([{ text: 'gaza ceasefire', weight: 1, status: 'active', provenance: 'tracked' }]);

  await deleteAllFacts();

  expect((await getActive()).map((t) => t.text)).toEqual(['gaza ceasefire']);
});

it('takes every place a fact gave, even one whose fact is long gone, and keeps a place added by hand', async () => {
  const city = await addFact('Lives in Delft, Netherlands');
  await upsertLocation({ city: 'Delft', countryCode: 'NL', role: 'home', provenance: 'user', sourceFactId: city.id });
  await upsertLocation({ city: 'Bhopal', countryCode: 'IN', role: 'family', provenance: 'llm', sourceFactId: 'deleted-fact' });
  await addUserLocation({ city: 'Porto', countryCode: 'PT', role: 'travel' });

  await deleteAllFacts();

  expect((await getLocations()).map((l) => l.city)).toEqual(['Porto']);
});

it('keeps a place added by hand when Mera had already derived the same one', async () => {
  await upsertLocation({ city: 'Porto', countryCode: 'PT', role: 'travel', provenance: 'llm', sourceFactId: 'a-fact' });
  await addUserLocation({ city: 'Porto', countryCode: 'PT', role: 'travel' });

  await deleteAllFacts();

  expect((await getLocations()).map((l) => l.city)).toEqual(['Porto']);
});
