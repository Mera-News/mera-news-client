// node scripts/artefact.mjs <outDir>: lays out the installable package, built files included, in outDir.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node scripts/artefact.mjs <outDir>');
if (!existsSync('dist')) throw new Error('dist is missing: run npm run build first');

const source = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = Object.fromEntries(
  ['name', 'version', 'description', 'license', 'author', 'engines', 'dependencies', 'peerDependencies'].map((key) => [key, source[key]]),
);
manifest.files = ['dist', 'node', 'types', 'schema.gql', 'news-schema.gql', 'news-schema.pin.json'];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const name of ['dist', 'node', 'types', 'schema.gql', 'news-schema.gql', 'news-schema.pin.json', 'LICENSE', 'TRADEMARK.md', 'COMMERCIAL.md', 'README.md']) {
  cpSync(name, join(outDir, name), { recursive: true });
}
