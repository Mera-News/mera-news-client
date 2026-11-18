// The public news server's schema, shipped as news-schema.gql so a host can check news operations
// against it. Never edited by hand: this script writes it from a mera-news-data-server commit.
//
//   node scripts/news-schema.mjs pin <commit> [<data server checkout>]   copy the schema at <commit> and pin it
//   node scripts/news-schema.mjs check [<data server checkout>]          fail unless the file is the pinned schema
//
// The checkout defaults to ../mera-news-data-server.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const SCHEMA = 'news-schema.gql';
const PIN = 'news-schema.pin.json';
const SOURCE = 'apps/mera-server-news-api/src/schema.gql';

const [command, arg, dirArg] = process.argv.slice(2);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

if (command === 'pin' && arg) {
  const dir = dirArg ?? '../mera-news-data-server';
  const rev = git(dir, 'rev-parse', '--verify', `${arg}^{commit}`).trim();
  const text = git(dir, 'show', `${rev}:${SOURCE}`);
  writeFileSync(SCHEMA, text);
  writeFileSync(PIN, `${JSON.stringify({ rev, sha256: sha256(text) }, null, 2)}\n`);
  console.log(`${SCHEMA} is the news schema at ${rev}`);
} else if (command === 'check') {
  const pin = JSON.parse(readFileSync(PIN, 'utf8'));
  const text = readFileSync(SCHEMA, 'utf8');
  if (sha256(text) !== pin.sha256) throw new Error(`${SCHEMA} was edited by hand: run pin again`);
  const dir = arg ?? '../mera-news-data-server';
  if (git(dir, 'show', `${pin.rev}:${SOURCE}`) !== text) throw new Error(`${SCHEMA} is not the schema at ${pin.rev}`);
  console.log(`${SCHEMA} matches ${pin.rev}`);
} else {
  console.error('usage: node scripts/news-schema.mjs pin <commit> [<data server checkout>] | check [<data server checkout>]');
  process.exit(2);
}
