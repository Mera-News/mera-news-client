// Every GraphQL operation in the client's documents is classified exactly once, so a new document
// cannot reach a news server, or stay off one, by accident.
import fs from 'node:fs';
import path from 'node:path';
import {
  ACCOUNT_OPERATION_NAMES,
  HOST_NEWS_OPERATION_NAMES,
  MERA_SERVICE_OPERATION_NAMES,
  NEWS_OPERATION_NAMES,
  isNewsOperation,
} from '@/lib/graphql/news-operations';

const LIB = path.resolve(__dirname, '../../../../lib');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'generated' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Operation names in every gql template of the client. */
function documentOperations(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(LIB)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [, body] of text.matchAll(/gql`([\s\S]*?)`/g)) {
      for (const [, , name] of body.matchAll(/\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        found.set(name, [...(found.get(name) ?? []), path.relative(LIB, file)]);
      }
    }
  }
  return found;
}

describe('the operation classes', () => {
  const operations = documentOperations();

  it('finds the documents it scans', () => {
    expect(operations.size).toBeGreaterThan(30);
  });

  it('classifies every operation in the documents', () => {
    const classified = new Set([...NEWS_OPERATION_NAMES, ...ACCOUNT_OPERATION_NAMES, ...MERA_SERVICE_OPERATION_NAMES]);
    expect([...operations.keys()].filter((name) => !classified.has(name)).sort()).toEqual([]);
  });

  it('puts no operation in two classes', () => {
    const all = [...NEWS_OPERATION_NAMES, ...ACCOUNT_OPERATION_NAMES, ...MERA_SERVICE_OPERATION_NAMES];
    expect(all.filter((name, i) => all.indexOf(name) !== i)).toEqual([]);
  });

  it('lists no operation that no document has', () => {
    const all = [...NEWS_OPERATION_NAMES, ...ACCOUNT_OPERATION_NAMES, ...MERA_SERVICE_OPERATION_NAMES];
    expect(all.filter((name) => !operations.has(name)).sort()).toEqual([]);
  });

  it('pins the news list, so a change to what may reach a news server is a deliberate edit here', () => {
    expect([...NEWS_OPERATION_NAMES].sort()).toEqual([
      'AllCountries',
      'ClusterMembershipsForArticles',
      'GetArticleById',
      'GetArticleIdsForPersona',
      'GetArticleIdsForTopics',
      'GetArticlesForCountry',
      'GetArticlesForPublisher',
      'GetArticlesForPublisherNoOrder',
      'GetArticlesForStories',
      'GetArticlesForStoriesLegacy',
      'GetArticlesForTopicsByIds',
      'GetArticlesForTopicsByIdsLegacy',
      'GetCanonicalTopics',
      'GetNewsClusterForArticle',
      'GetRecentArticleCount',
      'GetRelatedArticlesPage',
      'GetRelatedArticlesPageFiltered',
      'GetRelatedArticlesPageLegacy',
      'GetTopHeadlinesForCountry',
      'GetTopHeadlinesForCountryWindowed',
      'GetWorldHeadlines',
      'PlaceSearch',
      'PublicationDisplayNames',
      'PublicationSourcesForNewsPublisher',
      'SearchNews',
    ]);
  });

  it('keeps the host news list out of the client documents, so each name has one home', () => {
    expect(HOST_NEWS_OPERATION_NAMES.filter((name) => operations.has(name))).toEqual([]);
  });

  it('answers news only for a listed news operation', () => {
    expect(isNewsOperation('GetArticleIdsForPersona')).toBe(true);
    expect(isNewsOperation('PublicationProfile')).toBe(true);
    expect(isNewsOperation('GetUserPersona')).toBe(false);
    expect(isNewsOperation('GetFactCheck')).toBe(false);
    expect(isNewsOperation('SomethingNew')).toBe(false);
    expect(isNewsOperation(undefined)).toBe(false);
  });
});
