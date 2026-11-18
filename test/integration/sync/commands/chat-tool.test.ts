// A chat turn whose model offers a fact, then the tap that saves it, with a sink set: the offer writes
// nothing and sends nothing, the save sends exactly one commitFactChoices and writes nothing here.
import { PersonaUpdateAgent } from '@/lib/llm/agents/PersonaUpdateAgent';
import { commitAsWritten } from '@/lib/chat-session/cards/fact-choice-actions';
import { testHost } from '@/test/helpers';
import { factStatements, queuedJobs, resetAgentWorld } from '../../chat/tools/agents/agents-kit';

beforeEach(resetAgentWorld);

it('sends the saved fact as one commitFactChoices command and writes nothing local', async () => {
  const sent: { name: string; args: unknown[] }[] = [];
  testHost.podCommand = async (c) => {
    sent.push(c);
    return { savedFacts: [], conflicts: [] };
  };

  const agent = new PersonaUpdateAgent('user-1', 'ONBOARDING');
  const offer = await agent.executeTool('saveExtractedFacts', { extracted_user_information: ['Lives in Porto'] });
  expect(offer.result).toMatchObject({ staged: true });
  expect(sent).toEqual([]);

  await commitAsWritten([{ statement: 'Lives in Porto' }]);

  expect(sent.map((s) => s.name)).toEqual(['commitFactChoices']);
  expect(sent[0].args).toEqual([[{ statement: 'Lives in Porto' }]]);
  expect(await factStatements()).toEqual([]);
  expect(await queuedJobs()).toEqual([]);
});
