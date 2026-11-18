// The client ships the public news server's schema, so a host can check news operations against it.
// Every NEWS operation in the client's documents must validate against that schema, except the few
// named below, which must keep failing so the list cannot outlive its reasons. Account and Mera
// service operations go to Mera only and must not validate against it.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildSchema, parse, validate } from 'graphql';
import {
  ACCOUNT_OPERATION_NAMES,
  MERA_SERVICE_OPERATION_NAMES,
  NEWS_OPERATION_NAMES,
  NEWS_OPERATIONS_NOT_PUBLIC,
} from '@/lib/graphql/news-operations';

const ROOT = path.resolve(__dirname, '../../../..');
const LIB = path.join(ROOT, 'lib');

const NOT_PUBLIC = NEWS_OPERATIONS_NOT_PUBLIC;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'generated' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// A document may splice in a shared field list: a top-level `const NAME = `...`` in some lib file.
const CONSTANT = /^(?:export )?const ([A-Z][A-Z0-9_]*) = `([^`$]*)`/gm;

/** Each operation in the client's gql templates, as its own document, field lists spliced in. */
function documents(): Map<string, string> {
  const files = sourceFiles(LIB).map((file) => fs.readFileSync(file, 'utf8'));
  const constants = new Map<string, string>();
  for (const text of files) for (const [, name, value] of text.matchAll(CONSTANT)) constants.set(name, value);
  const found = new Map<string, string>();
  for (const text of files) {
    for (const [, raw] of text.matchAll(/gql`([\s\S]*?)`/g)) {
      const body = raw.replace(/\$\{(\w+)\}/g, (_, name: string) => {
        if (!constants.has(name)) throw new Error(`a gql document splices ${name}, which is not a plain constant`);
        return constants.get(name)!;
      });
      for (const def of parse(body).definitions) {
        if (def.kind === 'OperationDefinition' && def.name) found.set(def.name.value, body);
      }
    }
  }
  return found;
}

const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'news-schema.pin.json'), 'utf8')) as { rev: string; sha256: string };
const text = fs.readFileSync(path.join(ROOT, 'news-schema.gql'), 'utf8');
const schema = buildSchema(text);
const docs = documents();
const ROOTS = { query: schema.getQueryType(), mutation: schema.getMutationType(), subscription: schema.getSubscriptionType() };
/** Validation errors, plus a missing root type, which `validate` does not report. */
function errorsOf(name: string): string[] {
  const doc = parse(docs.get(name)!);
  const rootless = doc.definitions.filter((d) => d.kind === 'OperationDefinition' && !ROOTS[d.operation]).map((d) => `no ${(d as { operation: string }).operation} type`);
  return [...rootless, ...validate(schema, doc).map((e) => e.message)];
}

it('ships the schema of the pinned data server commit, unedited', () => {
  expect(pin.rev).toMatch(/^[0-9a-f]{40}$/);
  expect(createHash('sha256').update(text).digest('hex')).toBe(pin.sha256);
});

it('every news operation the client sends validates against the public schema', () => {
  const failing = NEWS_OPERATION_NAMES.filter((n) => docs.has(n) && !(n in NOT_PUBLIC)).map((n) => [n, errorsOf(n)]).filter(([, e]) => e.length);
  expect(failing).toEqual([]);
});

it.each(Object.entries(NOT_PUBLIC))('%s is still not public (%s); drop it from the list once it is', (name) => {
  expect(NEWS_OPERATION_NAMES).toContain(name);
  expect(errorsOf(name)).not.toEqual([]);
});

it('no account or Mera service operation validates against the public schema', () => {
  const names = [...ACCOUNT_OPERATION_NAMES, ...MERA_SERVICE_OPERATION_NAMES].filter((n) => docs.has(n));
  expect(names.length).toBeGreaterThan(10);
  expect(names.filter((n) => errorsOf(n).length === 0)).toEqual([]);
});

it('sends the server status document as a news operation', () => {
  expect(NEWS_OPERATION_NAMES).toContain('NewsServerStatus');
  expect(errorsOf('NewsServerStatus')).toEqual([]);
});
