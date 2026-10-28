import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverEnvSchema } from '@openscroll/config';
import {
  articles,
  cards,
  sources,
  userInteractions,
  userPreferences,
  users,
} from '@openscroll/db';
import { createWorkerContext, type WorkerContext } from './context';
import { recomputeUserVector } from './handlers';
import { silentLogger } from './logger';

const runDatabaseTests = process.env.RUN_WORKER_DB_TESTS === '1';

function unitEmbedding(): number[] {
  return Array.from({ length: 1024 }, (_value, index) => (index === 0 ? 1 : 0));
}

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

describe.skipIf(!runDatabaseTests)('user vector recomputation integration', () => {
  let ctx: WorkerContext;
  let userId: string;
  let sourceId: string;
  let cardId: string;

  beforeAll(async () => {
    const env = serverEnvSchema.parse({
      ...process.env,
      NODE_ENV: 'test',
      DIRECT_URL:
        process.env.DIRECT_URL ??
        'postgresql://openscroll:openscroll@localhost:5432/openscroll',
      LLM_PROVIDER: 'mock',
      EMBEDDING_PROVIDER: 'mock',
    });
    ctx = createWorkerContext({ env, logger: silentLogger });

    const suffix = randomUUID();
    const [user] = await ctx.db
      .insert(users)
      .values({ email: `vector-${suffix}@example.com` })
      .returning({ id: users.id });
    userId = user!.id;

    await ctx.db.insert(userPreferences).values({
      userId,
      topics: ['machine learning', 'distributed systems'],
    });

    const [source] = await ctx.db
      .insert(sources)
      .values({
        title: 'Vector test source',
        url: `https://vector.example.com/feed/${suffix}`,
        urlHash: suffix.replace(/-/g, '') + 'c'.repeat(32),
        sourceType: 'RSS',
      })
      .returning({ id: sources.id });
    sourceId = source!.id;

    const [article] = await ctx.db
      .insert(articles)
      .values({
        sourceId,
        title: 'Vector test article',
        originalUrl: `https://vector.example.com/${suffix}`,
        canonicalUrl: `https://vector.example.com/${suffix}`,
        urlHash: suffix.replace(/-/g, '') + 'd'.repeat(32),
        status: 'ready',
      })
      .returning({ id: articles.id });

    const [card] = await ctx.db
      .insert(cards)
      .values({
        articleId: article!.id,
        hook: 'Vector hook',
        coreConcept: 'Vector concept',
        keyTakeaways: ['vector'],
        estimatedReadTimeSec: 60,
        embedding: unitEmbedding(),
        embeddingDim: 1024,
        topicTags: ['machine learning'],
        status: 'published',
      })
      .returning({ id: cards.id });
    cardId = card!.id;
  });

  afterAll(async () => {
    if (ctx) {
      if (sourceId) {
        await ctx.db.delete(sources).where(eq(sources.id, sourceId));
      }
      if (userId) {
        await ctx.db.delete(users).where(eq(users.id, userId));
      }
      await ctx.pool.end();
    }
  });

  it('computes a normalized vector from topics and applies interactions', async () => {
    await recomputeUserVector(ctx, userId);
    const [initial] = await ctx.db
      .select({ vector: users.userVector })
      .from(users)
      .where(eq(users.id, userId));

    expect(initial?.vector).toHaveLength(1024);
    expect(norm(initial?.vector ?? [])).toBeCloseTo(1);

    await ctx.db.insert(userInteractions).values({
      userId,
      cardId,
      interactionType: 'LIKE',
      dwellTimeMs: 0,
      idempotencyKey: 'vector-like-1',
    });

    await recomputeUserVector(ctx, userId);
    const [updated] = await ctx.db
      .select({ vector: users.userVector })
      .from(users)
      .where(eq(users.id, userId));

    expect(updated?.vector).toHaveLength(1024);
    expect(norm(updated?.vector ?? [])).toBeCloseTo(1);
    expect(updated?.vector).not.toEqual(initial?.vector);
  });
});
