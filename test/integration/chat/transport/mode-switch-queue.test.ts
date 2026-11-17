// The inference queue re-reads the mode per job: a job queued in Cloud runs on the phone's engine
// once the reader switches to On this phone, and runs in the cloud again after the switch back.
import { addFact } from '@/lib/database/services/fact-service';
import { handlePersonaSummaryJob } from '@/lib/inference/handlers/persona-summary-handler';
import { useMeraProtocolStore } from '@/lib/stores/mera-protocol-store';
import { gatewayCalls, mockGateway, server } from '@/test/helpers';
import { installLlama, llamaCalls } from '@/test/integration/chat/_helpers/llama';
import { cleanup, driveDone, prepare, setMode } from '../inference/kit';

beforeEach(async () => {
  useMeraProtocolStore.getState().setModelState('downloaded');
  installLlama(['{"strings":[]}']);
  server.use(...mockGateway(() => '{"strings":[]}'));
  await prepare();
  await addFact('Lives in Pune');
});
afterEach(cleanup);

it('the next job follows the mode: cloud, then the phone, then cloud again', async () => {
  await driveDone(handlePersonaSummaryJob({ useCloud: true }));
  expect(gatewayCalls('chat')).toHaveLength(1);
  expect(llamaCalls()).toHaveLength(0);

  await setMode('on-device');
  await setMode('on-device');
  await driveDone(handlePersonaSummaryJob({ useCloud: true }));
  expect(gatewayCalls('chat')).toHaveLength(1); // no new cloud call
  expect(llamaCalls()).toHaveLength(1);

  await setMode('cloud');
  await driveDone(handlePersonaSummaryJob({ useCloud: true }));
  expect(gatewayCalls('chat')).toHaveLength(2);
  expect(llamaCalls()).toHaveLength(1);
});
