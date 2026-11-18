// The registry version is pinned to the command names: changing the names without a new version fails.
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (file: string) => readFileSync(join(__dirname, '../../../lib/sync', file), 'utf8');

// Read from source: loading the registry would load every writer, which needs a registered platform.
const names = [...read('commands.ts').match(/export const COMMANDS = \{([^}]*)\}/)![1].matchAll(/^\s*(\w+),$/gm)].map((m) => m[1]).sort();
const version = Number(read('command.ts').match(/COMMAND_REGISTRY_VERSION = (\d+)/)![1]);
const hash = createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 16);

// One line per released version. A changed registry adds a line with the next number.
const PINNED: Record<number, string> = {
  1: '2110780830d5943d',
  2: '2e2fa9f2017bb8e1',
};

it('pins the names of the current version', () => {
  expect(Object.keys(PINNED).map(Number).sort((a, b) => a - b).pop()).toBe(version);
  expect({ version, hash }).toEqual({ version, hash: PINNED[version] });
});

it('read the names', () => expect(names.length).toBeGreaterThan(40));
