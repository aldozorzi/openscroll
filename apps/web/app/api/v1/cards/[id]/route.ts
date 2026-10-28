import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  articles,
  cards,
  sources,
  userCardReviews,
  userInteractions,
} from '@openscroll/db';
import { requireAuth } from '../../../../../lib/auth';
import { accessibleSourceCondition } from '../../../../../lib/card-access';
import { getDb } from '../../../../../lib/db';
import { handleRoute, HttpError, json } from '../../../../../lib/http';
import { enforceRateLimit } from '../../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`card-detail:${session.user.id}`, 120, 60_000);

    const { id } = await context.params;
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid card id');
    }

    const [row] = await db
      .select({
        id: cards.id,
        articleId: cards.articleId,
        hook: cards.hook,
        coreConcept: cards.coreConcept,
        keyTakeaways: cards.keyTakeaways,
        topicTags: cards.topicTags,
        language: cards.language,
        estimatedReadTimeSec: cards.estimatedReadTimeSec,
        createdAt: cards.createdAt,
        status: cards.status,
        articleTitle: articles.title,
        originalUrl: articles.canonicalUrl,
        publishedAt: articles.publishedAt,
        sourceId: sources.id,
        sourceTitle: sources.title,
        sourceUrl: sources.url,
        reviewState: userCardReviews.state,
        nextReview: userCardReviews.nextReview,
        lastReview: userCardReviews.lastReview,
        reviewStability: userCardReviews.stability,
        reviewDifficulty: userCardReviews.difficulty,
      })
      .from(cards)
      .innerJoin(articles, eq(articles.id, cards.articleId))
      .leftJoin(sources, eq(sources.id, articles.sourceId))
      .leftJoin(
        userCardReviews,
        and(
          eq(userCardReviews.cardId, cards.id),
          eq(userCardReviews.userId, session.user.id),
        ),
      )
      .where(
        and(
          eq(cards.id, parsedId.data),
          eq(cards.status, 'published'),
          accessibleSourceCondition(session.user.id),
        ),
      )
      .limit(1);

    if (!row) {
      throw new HttpError(404, 'NOT_FOUND', 'Card not found');
    }

    const [saved] = await db
      .select({ id: userInteractions.id })
      .from(userInteractions)
      .where(
        and(
          eq(userInteractions.userId, session.user.id),
          eq(userInteractions.cardId, row.id),
          eq(userInteractions.interactionType, 'SAVE'),
        ),
      )
      .limit(1);

    return json({
      card: {
        id: row.id,
        article_id: row.articleId,
        hook: row.hook,
        core_concept: row.coreConcept,
        key_takeaways: row.keyTakeaways,
        topic_tags: row.topicTags,
        language: row.language,
        estimated_read_time_sec: row.estimatedReadTimeSec,
        created_at: row.createdAt.toISOString(),
        status: row.status,
        saved: Boolean(saved),
        source: {
          id: row.sourceId,
          title: row.sourceTitle,
          url: row.sourceUrl,
        },
        article: {
          title: row.articleTitle,
          original_url: row.originalUrl,
          published_at: row.publishedAt?.toISOString() ?? null,
        },
        review:
          row.nextReview !== null
            ? {
                state: row.reviewState ?? 0,
                next_review: row.nextReview.toISOString(),
                last_review: row.lastReview?.toISOString() ?? null,
                stability: row.reviewStability ?? 0,
                difficulty: row.reviewDifficulty ?? 0,
              }
            : null,
      },
    });
  });
}
