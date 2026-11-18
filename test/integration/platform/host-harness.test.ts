// A host may register a harness folder whose slots override the cloud base's. It must do so
// before any prompt module loads, because those modules read their slot text at import.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CLOUD_BASE_INCLUDED_BY } from '@/lib/harnesses/slots.generated';

type HostHarnessModule = typeof import('@/lib/harnesses/host-harness');
type SlotsModule = typeof import('@/lib/harnesses/slots.generated');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ROOT_SLOT = 'scoring/cloud-reason-system-prompt';

/** Runs `body` in a fresh module registry with a test host registered. */
function fresh(body: (m: HostHarnessModule) => void): void {
  jest.isolateModules(() => {
    require('../../helpers/platform-host').installTestPlatform();
    body(require('@/lib/harnesses/host-harness'));
  });
}

const harness = (folder: string, slots: Record<string, string>, extendsFolder = 'cloud-base', mapping?: Record<string, string>) => ({
  folder,
  file: { extends: extendsFolder, params: {} },
  slots,
  mapping,
});

test('an override reaches the prompt modules and changes only the leaves that read it', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../../unit/chat/llm/prompt-hashes.json'), 'utf8'));
  const pinned: Record<string, string> = snapshot.prompts['cloud-base'];
  const changed: string[] = [];
  fresh((m) => {
    m.applyHostHarness(harness('acme', { [ROOT_SLOT]: 'Host reason prompt' }));
    const prompts = require('@/lib/news-harness/prompts/prompts') as Record<string, unknown>;
    expect(prompts.CLOUD_REASON_SYSTEM_PROMPT).toBe('Host reason prompt');
    for (const [key, hash] of Object.entries(pinned)) {
      if (!key.startsWith('const:')) continue;
      const value = prompts[key.slice('const:'.length)];
      if (typeof value === 'string' && sha(value) !== hash) changed.push(key);
    }
  });
  expect(changed).toEqual(['const:CLOUD_REASON_SYSTEM_PROMPT']);
});

test('an override changes exactly that slot and no other slot of any folder', () => {
  fresh((m) => {
    const generated = require('@/lib/harnesses/slots.generated') as SlotsModule;
    const before = JSON.stringify(generated.HARNESS_SLOTS);
    const beforeCloud = { ...generated.CLOUD_BASE_SLOTS } as Record<string, string>;
    m.applyHostHarness(harness('acme', { [ROOT_SLOT]: 'Host reason prompt' }));
    const after = generated.CLOUD_BASE_SLOTS as Record<string, string>;
    expect(Object.keys(after).filter((id) => after[id] !== beforeCloud[id])).toEqual([ROOT_SLOT]);
    const others = { ...generated.HARNESS_SLOTS } as Record<string, unknown>;
    delete others.acme;
    // Every other folder's table is the same object it was, the cloud base apart from the one slot.
    const restored = JSON.parse(JSON.stringify(others));
    restored['cloud-base'][ROOT_SLOT] = beforeCloud[ROOT_SLOT];
    expect(JSON.stringify(restored)).toBe(before);
  });
});

test('a refused harness leaves nothing registered, so the same folder can be registered after', () => {
  fresh((m) => {
    const generated = require('@/lib/harnesses/slots.generated') as SlotsModule;
    const index = require('@/lib/harnesses') as typeof import('@/lib/harnesses');
    const cloudBefore = JSON.stringify(generated.CLOUD_BASE_SLOTS);
    expect(() => m.applyHostHarness(harness('acme', { [ROOT_SLOT]: 'x' }, 'device-base'))).toThrow(m.HostHarnessError);
    expect(() =>
      m.applyHostHarness(harness('acme', { [ROOT_SLOT]: 'y', 'scoring/no-such-slot': 'z' }, 'cloud-base', { 'near:m': 'acme' })),
    ).toThrow(m.HostHarnessError);
    expect('acme' in index.HARNESS_FILES).toBe(false);
    expect(index.harnessFolderFor('near', 'm')).toBeNull();
    expect(JSON.stringify(generated.CLOUD_BASE_SLOTS)).toBe(cloudBefore);
    m.applyHostHarness(harness('acme', { [ROOT_SLOT]: 'ok' }));
    expect((generated.CLOUD_BASE_SLOTS as Record<string, string>)[ROOT_SLOT]).toBe('ok');
  });
});

test('an unknown slot id throws, naming it', () => {
  fresh((m) => {
    expect(() => m.applyHostHarness(harness('acme', { 'scoring/no-such-slot': 'x' }))).toThrow(m.HostHarnessError);
    expect(() => m.applyHostHarness(harness('acme', { 'scoring/no-such-slot': 'x' }))).toThrow(/scoring\/no-such-slot/);
  });
});

test('overriding an included slot throws and names the slots that include it', () => {
  const included = 'scoring/rule-name-ban';
  expect(CLOUD_BASE_INCLUDED_BY[included]?.length).toBeGreaterThan(0);
  // The top-level slots: walk up until nothing includes the slot.
  const tops = new Set<string>();
  const up = (id: string) => (CLOUD_BASE_INCLUDED_BY[id] ?? []).forEach((p) => (CLOUD_BASE_INCLUDED_BY[p] ? up(p) : tops.add(p)));
  up(included);
  fresh((m) => {
    let message = '';
    try {
      m.applyHostHarness(harness('acme', { [included]: 'x' }));
    } catch (e) {
      expect(e).toBeInstanceOf(m.HostHarnessError);
      message = (e as Error).message;
    }
    expect(message).toContain(included);
    expect(message).toContain('override those slots instead');
    expect([...tops].some((t) => message.includes(t))).toBe(true);
  });
});

test('an include inside an override expands to the base text of that slot', () => {
  fresh((m) => {
    const base = (require('@/lib/harnesses/slots.generated') as SlotsModule).CLOUD_BASE_SLOTS['scoring/rule-name-ban'];
    m.applyHostHarness(harness('acme', { [ROOT_SLOT]: 'Before {{> scoring/rule-name-ban}} after' }));
    const prompts = require('@/lib/news-harness/prompts/prompts') as Record<string, unknown>;
    expect(prompts.CLOUD_REASON_SYSTEM_PROMPT).toBe(`Before ${base} after`);
  });
});

test('a folder name that already exists throws', () => {
  fresh((m) => {
    expect(() => m.applyHostHarness(harness('qwen3.8-27b', {}))).toThrow(/qwen3\.8-27b/);
  });
});

test('a harness extending the device base throws', () => {
  fresh((m) => {
    expect(() => m.applyHostHarness(harness('acme', {}, 'device-base'))).toThrow(/must extend a cloud harness/);
  });
});

test('mapping entries are visible through harnessFolderFor', () => {
  fresh((m) => {
    m.applyHostHarness(harness('acme', {}, 'cloud-base', { 'near:acme-model': 'acme' }));
    const { harnessFolderFor } = require('@/lib/harnesses') as typeof import('@/lib/harnesses');
    expect(harnessFolderFor('near', 'acme-model')).toBe('acme');
  });
});
