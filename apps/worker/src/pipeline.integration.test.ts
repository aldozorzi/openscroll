import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverEnvSchema } from '@openscroll/config';
import { articles, cards, sources } from '@openscroll/db';
import { hashUrl, type SafeFetchResponse } from '@openscroll/ingest';
import { createWorkerContext, type WorkerContext } from './context';
import { waitForDrain } from './drain';
import { ingestSource, registerHandlers } from './handlers';

const runDatabaseTests = process.env.RUN_WORKER_DB_TESTS === '1';

describe.skipIf(!runDatabaseTests)('worker pipeline integration (offline)', () => {
  let ctx: WorkerContext;
  let sourceId: string;
  let failingSourceId: string;
  let articleUrl: string;
  let feedFails = false;

  beforeAll(async () => {
    const env = serverEnvSchema.parse({
      ...process.env,
      NODE_ENV: 'test',
      DIRECT_URL:
        process.env.DIRECT_URL ??
        'postgresql://openscroll:openscroll@localhost:5432/openscroll',
      LLM_PROVIDER: 'mock',
      EMBEDDING_PROVIDER: 'mock',
      MAX_LLM_TOKENS_PER_DAY: 10_000_000,
      MAX_EMBEDDING_TOKENS_PER_DAY: 10_000_000,
    });

    const testScheme = 'http://openscroll.test';
    articleUrl = `${testScheme}/article-${randomUUID()}`;
    const feedUrl = `${testScheme}/feed-${randomUUID()}`;
    const uniqueSuffix = randomUUID();
    const articleText = [
      `Test article ${uniqueSuffix}: Idempotency is a property of an operation that allows it to be repeated`,
      'without changing the result beyond the initial application. In distributed',
      'systems, workers may crash after completing work but before acknowledging a',
      'message. Without idempotency, a retry can duplicate side effects such as',
      'charging a customer, sending an email, or creating a second database row.',
      'A common implementation is to attach a deterministic key to each command',
      'and store the outcome under that key in a transaction. When the command is',
      'retried, the system reads the stored outcome instead of executing the side',
      'effect again. The key must be derived from stable inputs rather than random',
      'values, and the storage must enforce uniqueness. Queue systems use the same',
      'idea when they deduplicate jobs by a singleton key. The handler still needs',
      'to be safe on its own, because deduplication windows are finite and a job',
      'may run again after the window expires. Idempotency therefore combines a',
      'stable identity, a durable record, and an atomic write. This makes retries',
      'safe, simplifies failure handling, and lets teams build systems that can',
      'recover from crashes without manual cleanup.',
    ].join(' ');
    const html = `<!doctype html><html lang="en"><head><title>Idempotency in practice</title></head><body><article><h1>Idempotency in practice</h1><p>${articleText}</p></article></body></html>`;

    ctx = createWorkerContext({
      env,
      fetchFeed: async (url) => {
        if (feedFails) {
          throw new Error('feed unavailable');
        }
        return {
          notModified: false,
          url: feedUrl,
          etag: '"e2e"',
          lastModified: null,
          feed: {
            title: 'E2E feed',
            description: null,
            siteUrl: null,
            language: 'en',
            items: [
              {
                externalId: 'e2e-item',
                url: articleUrl,
                title: 'Idempotency in practice',
                publishedAt: new Date().toISOString(),
                author: 'Test Author',
                contentHtml: html,
                contentText: articleText,
                summary: null,
              },
            ],
          },
        };
      },
      fetchArticle: async () =>
        ({
          url: articleUrl,
          status: 200,
          ok: true,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: Buffer.from(html),
          contentType: 'text/html',
          text: () => html,
          json: <T>() => JSON.parse(html) as T,
        }) satisfies SafeFetchResponse,
    });

    await ctx.queue.start();
    await registerHandlers(ctx);

    const [source] = await ctx.db
      .insert(sources)
      .values({
        title: 'E2E source',
        url: feedUrl,
        urlHash: hashUrl(feedUrl),
        sourceType: 'RSS',
        isPublic: false,
        isActive: true,
      })
      .returning({ id: sources.id });
    sourceId = source!.id;

    const failingFeedUrl = `${testScheme}/failing-feed-${randomUUID()}`;
    const [failingSource] = await ctx.db
      .insert(sources)
      .values({
        title: 'E2E failing source',
        url: failingFeedUrl,
        urlHash: hashUrl(failingFeedUrl),
        sourceType: 'RSS',
        isPublic: false,
        isActive: true,
      })
      .returning({ id: sources.id });
    failingSourceId = failingSource!.id;
  }, 30_000);

  afterAll(async () => {
    if (ctx) {
      if (sourceId) {
        await ctx.db.delete(sources).where(eq(sources.id, sourceId));
      }
      if (failingSourceId) {
        await ctx.db.delete(sources).where(eq(sources.id, failingSourceId));
      }
      await ctx.queue.stop({ graceful: true, timeoutMs: 10_000 });
      await ctx.pool.end();
    }
  }, 30_000);

  it('ingests, extracts, generates, and persists a card idempotently', async () => {
    await ingestSource(ctx, sourceId);
    await waitForDrain(ctx, {
      timeoutMs: 120_000,
      pollMs: 100,
      requireEmptyPolls: 3,
    });

    const [article] = await ctx.db
      .select()
      .from(articles)
      .where(eq(articles.sourceId, sourceId));
    expect(article).toBeDefined();
    expect(article?.status).toBe('ready');
    expect(article?.cleanedContent?.length).toBeGreaterThan(300);

    const [card] = await ctx.db
      .select()
      .from(cards)
      .where(eq(cards.articleId, article!.id));
    expect(card).toBeDefined();
    expect(card?.embedding?.length).toBe(1024);
    expect(card?.topicTags.length).toBeGreaterThan(0);

    await ingestSource(ctx, sourceId);
    await ingestSource(ctx, sourceId);
    await waitForDrain(ctx, {
      timeoutMs: 60_000,
      pollMs: 100,
      requireEmptyPolls: 3,
    });

    const cardsAfter = await ctx.db
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.articleId, article!.id));
    expect(cardsAfter).toHaveLength(1);
  }, 180_000);

  it('deactivates a source after three failed ingest cycles', async () => {
    feedFails = true;
    let now = Date.parse('2026-10-23T12:00:00.000Z');
    ctx.now = () => new Date(now);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(ingestSource(ctx, failingSourceId)).rejects.toThrow('feed unavailable');

      const [row] = await ctx.db
        .select()
        .from(sources)
        .where(eq(sources.id, failingSourceId));
      expect(row?.consecutiveFailures).toBe(attempt);
      expect(row?.lastError).toBe('feed unavailable');
      expect(row?.isActive).toBe(attempt < 3);

      now += 11 * 60 * 1000;
      ctx.now = () => new Date(now);
    }
  });
});