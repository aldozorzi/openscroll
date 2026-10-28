import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { InteractionSchema } from '@openscroll/contracts';
import { articles, cards, sources, userInteractions } from '@openscroll/db';
import { userSingletonKey } from '@openscroll/queue';
import { requireAuth } from '../../../../../../lib/auth';
import { accessibleSourceCondition } from '../../../../../../lib/card-access';
import { getDb } from '../../../../../../lib/db';
import { invalidateFeedCache } from '../../../../../../lib/feed';
import { handleRoute, HttpError, json, parseJson } from '../../../../../../lib/http';
import { requireIdempotencyKey } from '../../../../../../lib/idempotency';
import { enqueueSafely } from '../../../../../../lib/queue';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const InteractionBodySchema = InteractionSchema;

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
    enforceRateLimit(`interaction:${session.user.id}`, 120, 60_000);

    const { id } = await context.params;
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid card id');
    }

    const input = await parseJson(request, InteractionBodySchema);
    const dwellTimeMs = input.dwell_time_ms;
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

    if (input.interaction_type === 'UNSAVE') {
      const deleted = await db
        .delete(userInteractions)
        .where(
          and(
            eq(userInteractions.userId, session.user.id),
            eq(userInteractions.cardId, card.id),
            eq(userInteractions.interactionType, 'SAVE'),
          ),
        )
        .returning({ id: userInteractions.id });
      await invalidateFeedCache(session.user.id);
      return json(
        {
          unsaved: deleted.length > 0,
        },
        200,
      );
    }

    const [inserted] = await db
      .insert(userInteractions)
      .values({
        userId: session.user.id,
        cardId: card.id,
        interactionType: input.interaction_type,
        dwellTimeMs,
        idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: userInteractions.id, createdAt: userInteractions.createdAt });

    let interaction = inserted;
    if (!interaction) {
      const [existing] = await db
        .select({ id: userInteractions.id, createdAt: userInteractions.createdAt })
        .from(userInteractions)
        .where(
          and(
            eq(userInteractions.userId, session.user.id),
            eq(userInteractions.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new HttpError(500, 'INTERNAL_ERROR', 'Failed to store interaction');
      }
      interaction = existing;
    }

    await invalidateFeedCache(session.user.id);
    await enqueueSafely(
      'recompute-user-vector',
      { userId: session.user.id },
      {
        singletonKey: userSingletonKey(session.user.id),
        startAfter: new Date(Date.now() + 5_000),
      },
    );

    return json(
      {
        id: interaction.id,
        duplicate: !inserted,
        interaction_type: input.interaction_type,
        dwell_time_ms: dwellTimeMs,
        created_at: interaction.createdAt.toISOString(),
      },
      inserted ? 201 : 200,
    );
  });
}
