import { eq } from 'drizzle-orm';
import {
  cardReviews,
  sources,
  userCardReviews,
  userInteractions,
  userSources,
} from '@openscroll/db';
import { requireAuth } from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';
import { handleRoute } from '../../../../../lib/http';
import { getProfile } from '../../../../../lib/profile';
import { enforceRateLimit } from '../../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`export:${session.user.id}`, 3, 60_000);

    const userId = session.user.id;
    const [profile, interactions, reviews, reviewCards, ownedSources, subscriptions] =
      await Promise.all([
        getProfile(db, userId),
        db
          .select()
          .from(userInteractions)
          .where(eq(userInteractions.userId, userId)),
        db.select().from(cardReviews).where(eq(cardReviews.userId, userId)),
        db.select().from(userCardReviews).where(eq(userCardReviews.userId, userId)),
        db.select().from(sources).where(eq(sources.ownerId, userId)),
        db
          .select({
            sourceId: userSources.sourceId,
            isActive: userSources.isActive,
            createdAt: userSources.createdAt,
            title: sources.title,
            url: sources.url,
          })
          .from(userSources)
          .innerJoin(sources, eq(sources.id, userSources.sourceId))
          .where(eq(userSources.userId, userId)),
      ]);

    const payload = {
      format_version: 1,
      exported_at: new Date().toISOString(),
      profile,
      interactions: interactions.map((row) => ({
        id: row.id,
        card_id: row.cardId,
        interaction_type: row.interactionType,
        dwell_time_ms: row.dwellTimeMs,
        created_at: row.createdAt.toISOString(),
      })),
      review_history: reviews.map((row) => ({
        id: row.id,
        card_id: row.cardId,
        interval_days: row.scheduledDays,
        state_before: row.stateBefore,
        state_after: row.stateAfter,
        stability_before: row.stabilityBefore,
        stability_after: row.stabilityAfter,
        difficulty_before: row.difficultyBefore,
        difficulty_after: row.difficultyAfter,
        elapsed_days: row.elapsedDays,
        scheduled_days: row.scheduledDays,
        reviewed_at: row.reviewedAt.toISOString(),
      })),
      card_schedules: reviewCards.map((row) => ({
        card_id: row.cardId,
        stability: row.stability,
        difficulty: row.difficulty,
        state: row.state,
        reps: row.reps,
        lapses: row.lapses,
        last_review: iso(row.lastReview),
        next_review: row.nextReview.toISOString(),
      })),
      owned_sources: ownedSources.map((row) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        source_type: row.sourceType,
        is_public: row.isPublic,
        created_at: row.createdAt.toISOString(),
      })),
      subscriptions: subscriptions.map((row) => ({
        source_id: row.sourceId,
        title: row.title,
        url: row.url,
        is_active: row.isActive,
        subscribed_at: row.createdAt.toISOString(),
      })),
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="openscroll-export-${userId}.json"`,
        'cache-control': 'no-store',
      },
    });
  });
}
