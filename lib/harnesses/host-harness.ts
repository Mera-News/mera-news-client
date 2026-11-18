// A host registers its own harness folder before any prompt module loads: the cloud prompt modules
// read CLOUD_BASE_SLOTS at import, so the host's slot text is folded into it here.
import { HARNESS_FILES, HARNESS_MAPPING, loadHarness } from './index';
import { INCLUDE, slotText } from './slot-text';
import { CLOUD_BASE_INCLUDED_BY, CLOUD_BASE_SLOTS, HARNESS_SLOTS } from './slots.generated';
import type { HarnessFile } from './types';

export { slotText };

export interface HostHarness {
  folder: string;
  file: HarnessFile;
  /** Slot id -> text, as `slotText` returns it. May include other slots with `{{> id}}`. */
  slots: Record<string, string>;
  /** `<provider>:<model id>` -> folder. */
  mapping?: Record<string, string>;
}

export class HostHarnessError extends Error {}

const slots = CLOUD_BASE_SLOTS as Record<string, string>;

/** The slots nobody includes that sit above `id`, so a host knows what to override instead. */
function topLevelIncluders(id: string): string[] {
  const tops = new Set<string>();
  const up = (at: string) => {
    for (const parent of CLOUD_BASE_INCLUDED_BY[at] ?? []) if (CLOUD_BASE_INCLUDED_BY[parent]?.length) up(parent);
    else tops.add(parent);
  };
  up(id);
  return [...tops].sort();
}

/**
 * Registers the host's folder and folds its chain's slots into the cloud base. Everything is
 * checked before anything is written, so a refused harness leaves the registry as it was.
 */
export function applyHostHarness(h: HostHarness): void {
  if (h.folder in HARNESS_FILES) throw new HostHarnessError(`harness folder "${h.folder}" already exists`);
  const chain = [h.folder];
  for (let at = h.file.extends; at !== null; at = HARNESS_FILES[at].extends) {
    if (!HARNESS_FILES[at]) throw new HostHarnessError(`harness "${h.folder}": extends "${at}", which does not exist`);
    chain.unshift(at);
  }
  if (chain[0] !== 'cloud-base') throw new HostHarnessError(`harness "${h.folder}": a host harness must extend a cloud harness`);

  const staged: Record<string, string> = {};
  const read = (id: string) => (id in staged ? staged[id] : slots[id]);
  for (const folder of chain.slice(1)) {
    for (const [id, text] of Object.entries(folder === h.folder ? h.slots : HARNESS_SLOTS[folder] ?? {})) {
      if (!(id in slots)) throw new HostHarnessError(`harness "${folder}": "${id}" is not a slot of the cloud base`);
      if (CLOUD_BASE_INCLUDED_BY[id]?.length)
        throw new HostHarnessError(
          `harness "${folder}": "${id}" is included by other slots, so overriding it would not reach them; override those slots instead: ${topLevelIncluders(id).join(', ')}`,
        );
      staged[id] = text.replace(INCLUDE, (_m, x: string) => {
        if (!(x in slots)) throw new HostHarnessError(`harness "${folder}": slot "${id}" includes "${x}", which is not a slot of the cloud base`);
        return read(x);
      });
    }
  }

  HARNESS_FILES[h.folder] = h.file;
  Object.assign(HARNESS_MAPPING, h.mapping);
  Object.assign(slots, staged);
  HARNESS_SLOTS[h.folder] = Object.fromEntries(Object.keys(h.slots).map((id) => [id, staged[id]]));
  loadHarness(h.folder);
}
