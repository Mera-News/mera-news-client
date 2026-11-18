// A failed decode logs that it failed and how big the input was, never the text: the prompt carries
// the person's facts, and what the model wrote is about them. A warning becomes a crash-report
// breadcrumb in the app, next to the account.
import {
  parseBatchRelevanceResponse,
  parseFeedVerifierResponse,
  parseReasonResult,
} from '@/lib/news-harness/article-pipeline/scoring-decode';
import { parseTopicsFromOutput } from '@/lib/news-harness/persona-management/topic-generation';
import { decodeSanityVerdicts } from '@/lib/news-harness/persona-management/topic-sanity';

const SECRET = 'my divorce lawyer in Utrecht';

function recorder() {
  const lines: unknown[] = [];
  const log = (...args: unknown[]) => void lines.push(args);
  return { logger: { debug: log, info: log, warn: log, error: log }, text: () => JSON.stringify(lines), count: () => lines.length };
}

it.each([
  ['feed verifier output', (l: any) => parseFeedVerifierResponse(`no json about ${SECRET}`, 2, l, 'v1')],
  ['relevance output and prompt', (l: any) => parseBatchRelevanceResponse(`no numbers about ${SECRET}`, 2, 'r1', `facts: ${SECRET}`, undefined, l)],
  ['relevance prompt when padded', (l: any) => parseBatchRelevanceResponse('0.5', 2, 'r2', `facts: ${SECRET}`, undefined, l)],
  ['a deliberating reason', (l: any) => parseReasonResult(`Let me think about ${SECRET}`, 'n1', `facts: ${SECRET}`, l)],
  ['a reason that names its score', (l: any) => parseReasonResult(`This scores 0.68 because of ${SECRET}`, 'n2', undefined, l)],
  ['an unparseable reason and its prompt', (l: any) => parseReasonResult('   ', 'n3', `facts: ${SECRET}`, l)],
  ['topic generation output and fact', (l: any) => parseTopicsFromOutput(`no list about ${SECRET}`, `I see ${SECRET}`, l)],
  ['topic sanity output', (l: any) => decodeSanityVerdicts(`no verdicts about ${SECRET}`, ['t1'], l)],
])('a failed decode of %s logs no text', (_name, decode) => {
  const r = recorder();
  decode(r.logger);
  expect(r.count()).toBeGreaterThan(0);
  expect(r.text()).not.toContain('divorce');
});
