// add_topics / remove_topics write the topics table, so what chat adds or removes is what the
// feed profile asks for. Real in-memory DB, same kit as proposals.test.ts.
import * as factService from '@/lib/database/services/fact-service';
import { createTopics, getActive, getByFact } from '@/lib/database/services/topic-service';
import { buildRetrievalProfile } from '@/lib/news-harness/scoring-engine/retrieval-profile';
import * as executor from '@/lib/database/services/persona-action-executor';
import { executeProposalActions } from '@/lib/chat-tools/proposal-handlers';
import { resetChatModules, setProcessingMode } from '@/test/integration/chat/_helpers';

jest.setTimeout(30_000);

beforeEach(async () => {
  resetChatModules();
  await setProcessingMode('cloud');
});

async function profileTexts(): Promise<string[]> {
  const active = await getActive();
  const { topics } = buildRetrievalProfile({
    topics: active.map((t) => ({
      topicId: t.id,
      text: t.text,
      weight: t.weight,
      highPriority: t.highPriority,
      factId: t.factId,
    })),
    locations: [],
  });
  return topics.map((t) => t.text).sort();
}

describe('add_topics', () => {
  it('writes active user topics that the retrieval profile sends, without duplicating', async () => {
    const fact = await factService.addFact('s', { topics: ['a'] });
    await createTopics([{ factId: fact.id, text: 'a', weight: 0.5, status: 'active', provenance: 'llm' }]);

    const result = await executeProposalActions([{ type: 'add_topics', fact_id: fact.id, topics: ['a', 'Dutch Politics', ' '] }]);

    expect(result.applied).toBe(1);
    const rows = await getByFact(fact.id);
    expect(rows.map((r) => r.text).sort()).toEqual(['Dutch Politics', 'a']);
    expect(rows.find((r) => r.text === 'Dutch Politics')).toMatchObject({ status: 'active', provenance: 'user' });
    expect(await profileTexts()).toEqual(['Dutch Politics', 'a']);
  });
});

describe('remove_topics', () => {
  it("retires the fact's matched rows with one change-log row each and leaves other facts alone", async () => {
    const fact = await factService.addFact('s', { topics: ['Alpha', 'beta', 'gamma'] });
    const other = await factService.addFact('o', { topics: ['alpha'] });
    const w = { weight: 0.5, status: 'active' as const, provenance: 'llm' as const };
    await createTopics([
      { factId: fact.id, text: 'Alpha', ...w },
      { factId: fact.id, text: 'beta', ...w },
      { factId: fact.id, text: 'gamma', ...w },
      { factId: other.id, text: 'alpha', ...w },
    ]);

    const result = await executeProposalActions([
      { type: 'remove_topics', fact_id: fact.id, topics: ['ALPHA', 'beta', 'zzz'] },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.changeLogIds).toHaveLength(2);
    expect(await profileTexts()).toEqual(['alpha', 'gamma']);
    expect((await getByFact(fact.id)).filter((r) => r.status === 'retired').map((r) => r.text).sort()).toEqual(['Alpha', 'beta']);
    expect((await getByFact(other.id))[0].status).toBe('active');
    expect((await factService.getFacts()).find((f) => f.id === fact.id)?.metadata).toEqual({ topics: ['gamma'] });
  });

  it('keeps a text listed, and its row active, when the rails refuse its retire', async () => {
    const fact = await factService.addFact('s', { topics: ['keep', 'drop'] });
    const w = { weight: 0.5, status: 'active' as const, provenance: 'llm' as const };
    await createTopics([
      { factId: fact.id, text: 'keep', ...w },
      { factId: fact.id, text: 'drop', ...w },
    ]);
    const keepId = (await getByFact(fact.id)).find((r) => r.text === 'keep')!.id;
    const real = executor.applyPersonaAction;
    jest.spyOn(executor, 'applyPersonaAction').mockImplementation(async (a, source) =>
      'topicId' in a && a.topicId === keepId
        ? { applied: false, summary: 'refused' }
        : real(a, source),
    );

    const result = await executeProposalActions([
      { type: 'remove_topics', fact_id: fact.id, topics: ['keep', 'drop'] },
    ]);

    expect(result.errors).toEqual(['remove_topics: refused']);
    expect((await getByFact(fact.id)).map((r) => [r.text, r.status]).sort()).toEqual([
      ['drop', 'retired'],
      ['keep', 'active'],
    ]);
    expect((await factService.getFacts())[0].metadata).toEqual({ topics: ['keep'] });
  });
});
