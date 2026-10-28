import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { ReviewSchema } from '@openscroll/contracts';
import { articles, cards, sources } from '@openscroll/db';
import { FsrsError, submitReview } from '@openscroll/fsrs';
import { requireAuth } from '../../../../../../lib/auth';
import { accessibleSourceCondition } from '../../../../../../lib/card-access';
import { getDb } from '../../../../../../lib/db';
import { invalidateFeedCache } from '../../../../../../lib/feed';
import { handleRoute, HttpError, json, parseJson } from '../../../../../../lib/http';
import { requireIdempotencyKey } from '../../../../../../lib/idempotency';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`review:${session.user.id}`, 120, 60_000);

    const { id } = await context.params;
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid card id');
    }

    const input = await parseJson(request, ReviewSchema);
    const idempotencyKey = requireIdempotencyKey(request);

    const [card] = await db
      .select({ id: cards.id })
      .from(cards)
      .innerJoin(articles, eq(articles.id, cards.articleId))
      .leftJoin(sources, eq(sources.id, articles.sourceId))
      .where(
        and(
          eq(cards.id, parsedId.data),
          eq(cards.status, 'published'),
          accessibleSourceCondition(session.user.id),
        ),
      )
      .limit(1);
    if (!card) {
      throw new HttpError(404, 'NOT_FOUND', 'Card not found');
    }

    try {
      const result = await submitReview(db, {
        userId: session.user.id,
        cardId: parsedId.data,
        intervalDays: input.interval_days,
        idempotencyKey,
      });

      await invalidateFeedCache(session.user.id);

      return json({
        review_id: result.reviewId,
        card_id: result.cardId,
        interval_days: result.intervalDays,
        duplicate: result.duplicate,
        reviewed_at: result.reviewedAt.toISOString(),
        next_review: result.nextReview.toISOString(),
        state: result.state.state,
        stability: result.state.stability,
        difficulty: result.state.difficulty,
        reps: result.state.reps,
        lapses: result.state.lapses,
      });
    } catch (error) {
      if (error instanceof FsrsError) {
        if (error.code === 'CARD_NOT_FOUND') {
          throw new HttpError(404, 'NOT_FOUND', 'Card not found');
        }
        if (error.code === 'IDEMPOTENCY_CONFLICT') {
          throw new HttpError(409, 'CONFLICT', error.message);
        }
        throw new HttpError(400, 'BAD_REQUEST', error.message);
      }
      throw error;
    }
  });
}
