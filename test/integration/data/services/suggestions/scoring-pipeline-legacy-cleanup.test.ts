// scoring-pipeline-store: the one-shot removal of the single-slot design's persisted state. The flag
// is module memory with no reset export, so this is the ONLY test in its file and the first
// getPipeline() in the file is the one that cleans. "Once" is proved by state: the keys are put back
// afterwards and must survive the next call.
import { getSetting, setSetting } from '@/lib/database/services/setting-service';
import { getPipeline } from '@/lib/database/services/scoring-pipeline-store';
import { secureStoreDump, testHost } from '@/test/helpers';

const LEGACY_JOB = 'async_inference_pending_job';
const LEGACY_JOB_PRIVKEY = 'async_inference_pending_job_privkey';
const LEGACY_TOKEN = 'mera.cycle.capabilityToken';

async function plantLegacyState() {
  await setSetting(LEGACY_JOB, 'legacy-row');
  await testHost.secureStore.setItemAsync(LEGACY_JOB_PRIVKEY, 'legacy-secret');
  await testHost.asyncStorage.setItem(LEGACY_TOKEN, 'legacy-token');
}

it('removes the legacy settings row, keychain secret and AsyncStorage token on the first getPipeline, and only then', async () => {
  await plantLegacyState();

  expect(await getPipeline()).toBeNull();

  expect(await getSetting(LEGACY_JOB)).toBeNull();
  expect(secureStoreDump()[LEGACY_JOB_PRIVKEY]).toBeUndefined();
  expect(await testHost.asyncStorage.getItem(LEGACY_TOKEN)).toBeNull();

  // once per process: a second call leaves what was written since
  await plantLegacyState();
  expect(await getPipeline()).toBeNull();

  expect(await getSetting(LEGACY_JOB)).toBe('legacy-row');
  expect(secureStoreDump()[LEGACY_JOB_PRIVKEY]).toBe('legacy-secret');
  expect(await testHost.asyncStorage.getItem(LEGACY_TOKEN)).toBe('legacy-token');
});
