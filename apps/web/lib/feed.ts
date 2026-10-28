import { and, eq, gte, isNotNull, notExists, sql } from 'drizzle-orm';
import { getServerEnv } from '@openscroll/config';
import type { FeedQuery } from '@openscroll/contracts';
import type { Database } from '@openscroll/db';
import {
  articles,
  cards,
  sources,
  userCardReviews,
  userInteractions,
  userPreferences,
  users,
} from '@openscroll/db';
import {
  createFeedCacheKey,
  decodeCursor,
  rankFeed,
  RecommendationError,
  TtlFeedCache,
  type FeedCandidate,
  type FeedPage,
} from '@openscroll/recommendation';
import { accessibleSourceCondition } from './card-access';
import { HttpError } from './http';

const CANDIDATE_LIMIT = 500;
const MAX_PER_SOURCE = 2;
const MAX_PER_TOPIC = 3;

const globalForFeedCache = globalThis as typeof globalThis & {
  __openscrollFeedCache?: TtlFeedCache;
};

function feedCache(): TtlFeedCache {
  globalForFeedCache.__openscrollFeedCache ??= new TtlFeedCache({
    ttlMs: 60_000,
    maxEntries: 1_000,
  });
  return globalForFeedCache.__openscrollFeedCache;
}

function isTestMode(): boolean {
  return process.env.OPENSCROLL_USE_TEST_DB === 'true';
}

export async function invalidateFeedCache(userId: string): Promise<void> {
  await feedCache().invalidateUser(userId);
}

export async function clearFeedCacheForTests(): Promise<void> {
  await feedCache().invalidateAll();
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export async function getFeed(
  db: Database,
  userId: string,
  sessionCreatedAt: Date,
  query: FeedQuery,
): Promise<{ cards: FeedPage['cards']; nextCursor: string | null }> {
  let cursor = null;
  if (query.cursor) {
    try {
      cursor = decodeCursor(query.cursor);
    } catch {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid feed cursor');
    }
    if (cursor.mode !== query.mode) {
      throw new HttpError(400, 'BAD_REQUEST', 'Cursor does not match feed mode');
    }
  }

  const [user] = await db
    .select({ vector: users.userVector })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'User no longer exists');
  }

  const [preferences] = await db
    .select({
      language: userPreferences.language,
      excludedTopics: userPreferences.excludedTopics,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  const language = preferences?.language ?? null;
  const seed =
    cursor?.seed ??
    `${userId}:${query.mode}:${Math.floor(Date.now() / 60_000)}`;
  const cacheKey = createFeedCacheKey({
    userId,
    mode: query.mode,
    cursor: query.cursor ?? null,
    limit: query.limit,
    seed,
    language,
  });
  if (!isTestMode()) {
    const cached = await feedCache().get<FeedPage>(cacheKey);
    if (cached) {
      return { cards: cached.cards, nextCursor: cached.nextCursor };
    }
  }

  const dismissed = db
    .select({ present: sql`1` })
    .from(userInteractions)
    .where(
      and(
        eq(userInteractions.userId, userId),
        eq(userInteractions.cardId, cards.id),
        eq(userInteractions.interactionType, 'DISMISS'),
      ),
    );

  const seen = db
    .select({ present: sql`1` })
    .from(userInteractions)
    .where(
      and(
        eq(userInteractions.userId, userId),
        eq(userInteractions.cardId, cards.id),
        gte(userInteractions.createdAt, sessionCreatedAt),
      ),
    );

  const vector = user.vector;
  const orderBy =
    vector && vector.length > 0
      ? sql`${cards.embedding} <=> ${vectorLiteral(vector)}::vector`
      : sql`COALESCE(${articles.publishedAt}, ${cards.createdAt}) DESC`;

  const rows = await db
    .select({
      id: cards.id,
      articleId: cards.articleId,
      hook: cards.hook,
      coreConcept: cards.coreConcept,
      keyTakeaways: cards.keyTakeaways,
      topicTags: cards.topicTags,
      language: cards.language,
      estimatedReadTimeSec: cards.estimatedReadTimeSec,
      embedding: cards.embedding,
      createdAt: cards.createdAt,
      publishedAt: articles.publishedAt,
      originalUrl: articles.canonicalUrl,
      sourceId: sources.id,
      sourceTitle: sources.title,
      sourceUrl: sources.url,
      reviewNextReview: userCardReviews.nextReview,
      reviewLastReview: userCardReviews.lastReview,
      reviewState: userCardReviews.state,
    })
    .from(cards)
    .innerJoin(articles, eq(articles.id, cards.articleId))
    .leftJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(
      userCardReviews,
      and(
        eq(userCardReviews.cardId, cards.id),
        eq(userCardReviews.userId, userId),
      ),
    )
    .where(
      and(
        eq(cards.status, 'published'),
        isNotNull(cards.embedding),
        accessibleSourceCondition(userId),
        language ? eq(cards.language, language) : undefined,
        notExists(dismissed),
        notExists(seen),
      ),
    )
    .orderBy(orderBy)
    .limit(CANDIDATE_LIMIT);

  const candidates: FeedCandidate[] = rows.map((row) => ({
    id: row.id,
    articleId: row.articleId,
    hook: row.hook,
    coreConcept: row.coreConcept,
    keyTakeaways: row.keyTakeaways,
    topicTags: row.topicTags,
    language: row.language,
    estimatedReadTimeSec: row.estimatedReadTimeSec,
    embedding: row.embedding,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
    sourceId: row.sourceId,
    sourceTitle: row.sourceTitle,
    sourceUrl: row.sourceUrl,
    originalUrl: row.originalUrl,
    status: 'published',
    review:
      row.reviewNextReview !== null
        ? {
            nextReview: row.reviewNextReview,
            lastReview: row.reviewLastReview,
            state: row.reviewState ?? 0,
          }
        : null,
  }));

  let page: FeedPage;
  try {
    page = rankFeed(candidates, {
      now: new Date(),
      mode: query.mode,
      limit: query.limit,
      seed,
      userVector: vector,
      cursor: query.cursor ?? null,
      halfLifeDays: getServerEnv().FEED_FRESHNESS_HALF_LIFE_DAYS,
      excludedTopics: preferences?.excludedTopics ?? [],
      language,
      maxPerSource: MAX_PER_SOURCE,
      maxPerTopic: MAX_PER_TOPIC,
    });
  } catch (error) {
    if (error instanceof RecommendationError) {
      throw new HttpError(400, 'BAD_REQUEST', error.message);
    }
    throw error;
  }

  if (!isTestMode()) {
    await feedCache().set(cacheKey, page);
  }
  return { cards: page.cards, nextCursor: page.nextCursor };
}