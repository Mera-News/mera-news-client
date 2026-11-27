// ArticleService's id queries and hydration against the real Apollo client and MSW: the recent
// count, per-topic ids, persona ids (both chunked at 150 topics), and the two hydration reads
// (quota-charged and quota-exempt), chunked at 50 ids.
import ArticleService from '@/lib/article-service';
import { useForYouStore } from '@/lib/stores/for-you-store';
import type { PersonaQueryInput } from '@/lib/generated/graphql-types';
import { advanceUntilDone, mockGql, mockGqlError, server, useFakeClock } from '@/test/helpers';
import {
    ARTICLE_IDS,
    COUNTRY_HEADLINE_IDS,
    GLOBAL_HEADLINE_IDS,
    TOPIC_ARTICLE_IDS,
} from '@/test/mock-backend/fixtures/articles';
import {
    articleWithClusters,
    expectNoServiceCapture,
    failOp,
    recordOps,
    resetServiceState,
    sentOf,
    spyLogger,
} from './kit';

beforeEach(resetServiceState);

const crumbOf = (crumb: jest.SpyInstance, text: string) => crumb.mock.calls.find((c) => String(c[0]).includes(text));

describe('getRecentArticleCount', () => {
    it('returns the count the server sends, and asks again every time (no-cache)', async () => {
        server.use(mockGql('GetRecentArticleCount', { recentArticleCount: 42 }));
        const sent = recordOps();
        expect(await ArticleService.getRecentArticleCount()).toBe(42);
        expect(await ArticleService.getRecentArticleCount()).toBe(42);
        expect(await sentOf(sent, 'GetRecentArticleCount')).toHaveLength(2);
    });

    it('serves the default fixture count', async () => {
        expect(await ArticleService.getRecentArticleCount()).toBe(ARTICLE_IDS.length);
    });

    it('returns null when the whole response is { data: null }', async () => {
        const logs = spyLogger();
        server.use(mockGql('GetRecentArticleCount', null));
        expect(await ArticleService.getRecentArticleCount()).toBeNull();
        // The null comes from the `?? null`, not from the catch: Apollo resolved, nothing was thrown.
        expect(logs.crumb).not.toHaveBeenCalledWith(expect.stringContaining('failed'), 'article-service', expect.anything(), expect.anything());
    });

    it('returns null when the field is null (a failure: recentArticleCount is Int!)', async () => {
        server.use(mockGql('GetRecentArticleCount', { recentArticleCount: null }));
        expect(await ArticleService.getRecentArticleCount()).toBeNull();
    });

    it('swallows a server error, returns null, and leaves a breadcrumb with no capture of its own', async () => {
        const logs = spyLogger();
        server.use(mockGqlError('GetRecentArticleCount', 'INTERNAL_SERVER_ERROR'));
        await expect(ArticleService.getRecentArticleCount()).resolves.toBeNull();
        expectNoServiceCapture(logs.capture);
        expect(logs.crumb).toHaveBeenCalledWith(
            expect.stringContaining('getRecentArticleCount failed'),
            'article-service',
            expect.objectContaining({ method: 'getRecentArticleCount' }),
            'warning',
        );
    });

    it('swallows a transport failure the same way, after the link has retried', async () => {
        const logs = spyLogger();
        useFakeClock(Date.now());
        server.use(failOp('GetRecentArticleCount'));
        await expect(advanceUntilDone(ArticleService.getRecentArticleCount())).resolves.toBeNull();
        expect(crumbOf(logs.crumb, 'getRecentArticleCount failed')).toBeDefined();
        expectNoServiceCapture(logs.capture);
    });
});

const personaTopics = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ text: `t${i + offset}` }));
const topHeadlines = {
    scopes: [{ scope: 'GLOBAL', countryCode: null }],
    limitPerScope: 5,
} as unknown as PersonaQueryInput['topHeadlines'];
const personaTopicResult = (text: string) => ({
    __typename: 'PersonaTopicResult',
    topicText: text,
    articleIds: [`a-${text}`],
    matchMeta: [],
    nextCursor: null,
    hasNextPage: false,
});
const headlineResult = (scope: string) => ({
    __typename: 'HeadlineScopeResult',
    scope,
    countryCode: null,
    articleIds: [`h-${scope}`],
    clusterSizes: [1],
    stableClusterIds: ['sc-1'],
});
const personaReply = (topicTexts: string[], scopes: string[] = []) => ({
    articleIdsForPersona: {
        __typename: 'PersonaQueryResult',
        topicResults: topicTexts.map(personaTopicResult),
        headlineResults: scopes.map(headlineResult),
    },
});
const personaQuery = (over: Record<string, unknown>) => over as unknown as PersonaQueryInput;

describe('getArticleIdsForPersona', () => {
    it('sends the query as one variable and serves topic matches and headline scopes separately', async () => {
        const sent = recordOps();
        const query = personaQuery({
            topics: [{ text: 'f1' }, { text: 'chess' }],
            topHeadlines: {
                scopes: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryCode: 'NLD' }],
                limitPerScope: 10,
            },
        });
        const result = await ArticleService.getArticleIdsForPersona(query);

        expect((await sentOf(sent, 'GetArticleIdsForPersona'))[0].variables).toEqual({ query });
        expect(result.topicResults.map((r) => r.topicText)).toEqual(['f1', 'chess']);
        expect(result.topicResults.flatMap((r) => r.articleIds).sort()).toEqual([...TOPIC_ARTICLE_IDS].sort());
        expect(result.headlineResults.map((h) => h.scope)).toEqual(['GLOBAL', 'COUNTRY']);
        expect(result.headlineResults[0].articleIds).toEqual([...GLOBAL_HEADLINE_IDS]);
        expect(result.headlineResults[1].articleIds).toEqual([...COUNTRY_HEADLINE_IDS]);
        expect(result.headlineResults[1].countryCode).toBe('NLD');
    });

    it('returns the empty shape when the whole response is { data: null }', async () => {
        server.use(mockGql('GetArticleIdsForPersona', null));
        expect(await ArticleService.getArticleIdsForPersona(personaQuery({ topics: [] }))).toEqual({
            topicResults: [],
            headlineResults: [],
        });
    });

    it('returns the empty shape when the server sends a null field', async () => {
        server.use(mockGql('GetArticleIdsForPersona', { articleIdsForPersona: null }));
        expect(await ArticleService.getArticleIdsForPersona(personaQuery({ topics: [] }))).toEqual({
            topicResults: [],
            headlineResults: [],
        });
    });

    it('rethrows with a breadcrumb and no capture of its own', async () => {
        const logs = spyLogger();
        server.use(mockGqlError('GetArticleIdsForPersona', 'INTERNAL_SERVER_ERROR', { message: 'persona query failed' }));
        await expect(
            ArticleService.getArticleIdsForPersona(personaQuery({ topics: personaTopics(1) })),
        ).rejects.toThrow('persona query failed');
        expectNoServiceCapture(logs.capture);
        expect(logs.crumb).toHaveBeenCalledWith(
            expect.stringContaining('getArticleIdsForPersona FAILED'),
            'article-service',
            expect.objectContaining({ topicCount: 1, method: 'getArticleIdsForPersona' }),
            'warning',
        );
    });

    describe('the reader\'s language', () => {
        const query = personaQuery({ topics: personaTopics(1) });
        const validationFailed = () =>
            mockGqlError('GetArticleIdsForPersonaForLanguage', 'GRAPHQL_VALIDATION_FAILED', {
                httpStatus: 400,
                headers: { 'Content-Type': 'application/graphql-response+json' },
            });

        it('a valid language goes with the language document', async () => {
            const sent = recordOps();
            await ArticleService.getArticleIdsForPersona(query, 'hi');
            const calls = await sentOf(sent);
            expect(calls.map((c) => c.op)).toEqual(['GetArticleIdsForPersonaForLanguage']);
            expect(calls[0].variables).toEqual({ query, language: 'hi' });
        });

        it.each([[undefined], [null], [''], ['english'], ['f1']])('%j sends today\'s document with the query only', async (language) => {
            const sent = recordOps();
            await ArticleService.getArticleIdsForPersona(query, language);
            const calls = await sentOf(sent);
            expect(calls.map((c) => c.op)).toEqual(['GetArticleIdsForPersona']);
            expect(calls[0].variables).toEqual({ query });
        });

        it('a rejected language document latches: no capture, today\'s document answers in the same call', async () => {
            const logs = spyLogger();
            server.use(validationFailed());
            const sent = recordOps();
            const result = await ArticleService.getArticleIdsForPersona(query, 'hi');
            await ArticleService.getArticleIdsForPersona(query, 'hi');
            expect((await sentOf(sent)).map((c) => c.op)).toEqual([
                'GetArticleIdsForPersonaForLanguage',
                'GetArticleIdsForPersona',
                'GetArticleIdsForPersona',
            ]);
            expect(result.topicResults).toHaveLength(1);
            expect(logs.capture).not.toHaveBeenCalled();
        });

        it('any other error rethrows and does not latch', async () => {
            server.use(mockGqlError('GetArticleIdsForPersonaForLanguage', 'INTERNAL_SERVER_ERROR', { message: 'persona language failed' }));
            await expect(ArticleService.getArticleIdsForPersona(query, 'hi')).rejects.toThrow('persona language failed');
            server.resetHandlers();
            const sent = recordOps();
            await ArticleService.getArticleIdsForPersona(query, 'hi');
            expect((await sentOf(sent)).map((c) => c.op)).toEqual(['GetArticleIdsForPersonaForLanguage']);
        });
    });
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
/** Echoes one article per requested id; ids at or past `capFrom` clip the response and set the cap. */
const hydrate = (op: string, key: string, over: (asked: string[]) => Record<string, unknown> = () => ({})) =>
    mockGql(op, (v) => {
        const asked = v.articleIds as string[];
        return {
            [key]: {
                __typename: 'ArticlesForTopicsByIdsResponse',
                articles: asked.map(articleWithClusters),
                dailyLimitReached: false,
                resetAt: null,
                ...over(asked),
            },
        };
    });

// An older server rejects a document with the real graphql-response+json 400.
describe.each([
    ['getArticlesForTopicsByIds', 'GetArticlesForTopicsByIds'],
    ['getArticlesForStories', 'GetArticlesForStories'],
] as const)('%s hydration tiers', (method, op) => {
    const reject = (name: string) =>
        mockGqlError(name, 'GRAPHQL_VALIDATION_FAILED', {
            httpStatus: 400,
            headers: { 'Content-Type': 'application/graphql-response+json' },
        });
    const wanted = ARTICLE_IDS.slice(0, 2);
    const sequence = async (sent: Awaited<ReturnType<typeof recordOps>>) => (await sentOf(sent)).map((c) => c.op);

    it('sends the scored document first and returns the fixture reading scores', async () => {
        const sent = recordOps();
        const result = await ArticleService[method]([ARTICLE_IDS[0], ARTICLE_IDS[1], ARTICLE_IDS[3]]);
        expect(await sequence(sent)).toEqual([`${op}Scored`]);
        const scoreOf = (id: string) => result.articles.find((a) => a._id === id)?.readingScore;
        expect([scoreOf(ARTICLE_IDS[0]), scoreOf(ARTICLE_IDS[1]), scoreOf(ARTICLE_IDS[3])]).toEqual([72, null, 15]);
    });

    it('a server without readingScore falls back to today\'s document once, latches, and neither captures nor raises the sync banner', async () => {
        const logs = spyLogger();
        server.use(reject(`${op}Scored`));
        const sent = recordOps();
        const result = await ArticleService[method]([...wanted]);
        await ArticleService[method]([...wanted]);
        expect(await sequence(sent)).toEqual([`${op}Scored`, op, op]);
        expect(result.articles.map((a) => a._id).sort()).toEqual([...wanted].sort());
        expect(logs.capture).not.toHaveBeenCalled();
        expect(useForYouStore.getState().syncStatusMessage).toBeNull();
    });

    it('a server without story_key (and so without readingScore) walks scored, today\'s, then Legacy, and latches both', async () => {
        const logs = spyLogger();
        server.use(reject(`${op}Scored`), reject(op));
        const sent = recordOps();
        const result = await ArticleService[method]([...wanted]);
        await ArticleService[method]([...wanted]);
        expect(await sequence(sent)).toEqual([`${op}Scored`, op, `${op}Legacy`, `${op}Legacy`]);
        expect(result.articles.map((a) => a._id).sort()).toEqual([...wanted].sort());
        expect(logs.capture).not.toHaveBeenCalled();
        expect(useForYouStore.getState().syncStatusMessage).toBeNull();
    });

    it('after both are latched, the next call goes straight to Legacy', async () => {
        server.use(reject(`${op}Scored`), reject(op));
        await ArticleService[method]([...wanted]);
        server.resetHandlers();
        const sent = recordOps();
        await ArticleService[method]([...wanted]);
        expect(await sequence(sent)).toEqual([`${op}Legacy`]);
    });

    it('any other error on the scored document is rethrown and does not latch', async () => {
        server.use(mockGqlError(`${op}Scored`, 'INTERNAL_SERVER_ERROR'));
        await expect(ArticleService[method]([ARTICLE_IDS[0]])).rejects.toThrow();
        server.resetHandlers();
        const sent = recordOps();
        await ArticleService[method]([ARTICLE_IDS[0]]);
        expect(await sequence(sent)).toEqual([`${op}Scored`]);
    });

    it('any other error on today\'s document is rethrown and does not latch', async () => {
        server.use(reject(`${op}Scored`), mockGqlError(op, 'INTERNAL_SERVER_ERROR'));
        await expect(ArticleService[method]([ARTICLE_IDS[0]])).rejects.toThrow();
        server.resetHandlers();
        const sent = recordOps();
        await ArticleService[method]([ARTICLE_IDS[0]]);
        // The scored document is latched off by its own rejection; today's document is tried again.
        expect(await sequence(sent)).toEqual([op]);
    });
});

describe('getArticlesForTopicsByIds', () => {
    const echo = () => hydrate('GetArticlesForTopicsByIdsScored', 'articlesForTopicsByIds');

    it('returns an empty result for no ids without sending a request', async () => {
        const sent = recordOps();
        expect(await ArticleService.getArticlesForTopicsByIds([])).toEqual({ articles: [] });
        expect(await sentOf(sent)).toHaveLength(0);
    });

    it('hydrates the fixture articles for one chunk, with nothing but the articles in the result', async () => {
        const wanted = ARTICLE_IDS.slice(0, 3);
        const sent = recordOps();
        const result = await ArticleService.getArticlesForTopicsByIds([...wanted]);
        expect(result.articles.map((a) => a._id).sort()).toEqual([...wanted].sort());
        expect(Object.keys(result)).toEqual(['articles']);
        expect(await sentOf(sent, 'GetArticlesForTopicsByIdsScored')).toHaveLength(1);
    });

    it.each([
        [3, [3]],
        [50, [50]],
        [51, [50, 1]],
        [150, [50, 50, 50]],
    ])('splits %i ids into chunks of %j', async (count, sizes) => {
        server.use(echo());
        const sent = recordOps();
        const result = await ArticleService.getArticlesForTopicsByIds(ids(count));
        const calls = await sentOf(sent, 'GetArticlesForTopicsByIdsScored');
        expect(calls.map((c) => c.variables.articleIds.length).sort((a, b) => b - a)).toEqual(sizes);
        expect(result.articles).toHaveLength(count);
    });

    it('sends the chunk boundaries as the variables', async () => {
        server.use(echo());
        const sent = recordOps();
        await ArticleService.getArticlesForTopicsByIds(ids(60));
        const calls = (await sentOf(sent, 'GetArticlesForTopicsByIdsScored')).map((c) => c.variables.articleIds as string[]);
        const first = calls.find((c) => c[0] === 'id-0')!;
        const second = calls.find((c) => c[0] === 'id-50')!;
        expect(first).toHaveLength(50);
        expect(second).toHaveLength(10);
    });

    it('a server that still caps downloads just returns fewer articles: no error, the cap fields never selected', async () => {
        // The granted prefix of each chunk, the way articlesForTopicsByIds clips while
        // the server's download cap is on. The extra fields are not in the document.
        server.use(
            hydrate('GetArticlesForTopicsByIdsScored', 'articlesForTopicsByIds', (asked) => ({
                articles: asked.slice(0, 2).map(articleWithClusters),
                dailyLimitReached: true,
                resetAt: '2026-06-25T00:00:00.000Z',
            })),
        );
        const sent = recordOps();
        const result = await ArticleService.getArticlesForTopicsByIds(ids(51));
        expect(result.articles.map((a) => a._id).sort()).toEqual(['id-0', 'id-1', 'id-50'].sort());
        expect(Object.keys(result)).toEqual(['articles']);
        const [first] = await sentOf(sent, 'GetArticlesForTopicsByIdsScored');
        expect(first.query).toContain('articlesForTopicsByIds');
        expect(first.query).not.toMatch(/dailyLimitReached|resetAt/);
    });

    it('reports progress from (0, total) up to (total, total)', async () => {
        server.use(echo());
        const progress: [number, number][] = [];
        await ArticleService.getArticlesForTopicsByIds(ids(100), (done, total) => progress.push([done, total]));
        expect(progress[0]).toEqual([0, 100]);
        expect(progress.every(([, total]) => total === 100)).toBe(true);
        expect(progress[progress.length - 1][0]).toBe(100);
        expect(progress.map(([done]) => done)).toEqual([...progress.map(([done]) => done)].sort((a, b) => a - b));
    });

    it('treats a null field as an empty result', async () => {
        server.use(mockGql('GetArticlesForTopicsByIdsScored', { articlesForTopicsByIds: null }));
        const result = await ArticleService.getArticlesForTopicsByIds(['id1']);
        expect(result).toEqual({ articles: [] });
    });

    it('rethrows with an error-level breadcrumb and no capture of its own', async () => {
        const logs = spyLogger();
        server.use(mockGqlError('GetArticlesForTopicsByIdsScored', 'INTERNAL_SERVER_ERROR', { message: 'batch fetch error' }));
        await expect(ArticleService.getArticlesForTopicsByIds(['id1'])).rejects.toThrow('batch fetch error');
        expectNoServiceCapture(logs.capture);
        expect(logs.crumb).toHaveBeenCalledWith(
            expect.stringContaining('getArticlesForTopicsByIds FAILED'),
            'article-service',
            expect.objectContaining({ idCount: 1, method: 'getArticlesForTopicsByIds' }),
            'error',
        );
    });
});

// The quota-exempt sibling the legacy suite never covered: same chunking, no cap fields.
describe('getArticlesForStories', () => {
    it('returns an empty result for no ids without sending a request', async () => {
        const sent = recordOps();
        expect(await ArticleService.getArticlesForStories([])).toEqual({ articles: [] });
        expect(await sentOf(sent)).toHaveLength(0);
    });

    it('hydrates the fixture articles', async () => {
        const wanted = ARTICLE_IDS.slice(0, 3);
        const result = await ArticleService.getArticlesForStories([...wanted]);
        expect(result.articles.map((a) => a._id).sort()).toEqual([...wanted].sort());
    });

    it('splits 51 ids into 50 then 1 and reports progress', async () => {
        server.use(hydrate('GetArticlesForStoriesScored', 'articlesForStories'));
        const sent = recordOps();
        const progress: number[] = [];
        const result = await ArticleService.getArticlesForStories(ids(51), (done) => progress.push(done));
        const calls = await sentOf(sent, 'GetArticlesForStoriesScored');
        expect(calls.map((c) => c.variables.articleIds.length).sort((a, b) => b - a)).toEqual([50, 1]);
        expect(result.articles).toHaveLength(51);
        expect(progress[0]).toBe(0);
        expect(progress[progress.length - 1]).toBe(51);
    });

    it('rethrows with an error-level breadcrumb and no capture of its own', async () => {
        const logs = spyLogger();
        server.use(mockGqlError('GetArticlesForStoriesScored', 'INTERNAL_SERVER_ERROR', { message: 'stories failed' }));
        await expect(ArticleService.getArticlesForStories(['id1'])).rejects.toThrow('stories failed');
        expectNoServiceCapture(logs.capture);
        expect(logs.crumb).toHaveBeenCalledWith(
            expect.stringContaining('getArticlesForStories FAILED'),
            'article-service',
            expect.objectContaining({ idCount: 1, method: 'getArticlesForStories' }),
            'error',
        );
    });
});
