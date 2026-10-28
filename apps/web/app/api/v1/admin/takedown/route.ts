import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { articles, auditLog, cards } from '@openscroll/db';
import { requireAdmin } from '../../../../../lib/admin';
import { getDb } from '../../../../../lib/db';
import { handleRoute, HttpError, json, parseJson } from '../../../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TakedownSchema = z
  .object({
    article_id: z.uuid().optional(),
    card_id: z.uuid().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((value) => Boolean(value.article_id) !== Boolean(value.card_id), {
    message: 'Provide exactly one of article_id or card_id',
    path: ['article_id'],
  });

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const admin = await requireAdmin(request, db);
    const input = await parseJson(request, TakedownSchema);

    const result = await db.transaction(async (tx) => {
      let articleId = input.article_id;

      if (input.card_id) {
        const [card] = await tx
          .select({ articleId: cards.articleId })
          .from(cards)
          .where(eq(cards.id, input.card_id))
          .limit(1);
        if (!card) {
          throw new HttpError(404, 'NOT_FOUND', 'Card not found');
        }
        articleId = card.articleId;
      }

      const [article] = await tx
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.id, articleId as string))
        .limit(1);
      if (!article) {
        throw new HttpError(404, 'NOT_FOUND', 'Article not found');
      }

      await tx
        .update(cards)
        .set({ status: 'hidden', updatedAt: new Date() })
        .where(eq(cards.articleId, article.id));

      await tx
        .update(articles)
        .set({
          status: 'skipped',
          rawContent: null,
          cleanedContent: null,
          lastError: 'Removed by administrator',
          updatedAt: new Date(),
        })
        .where(eq(articles.id, article.id));

      await tx.insert(auditLog).values({
        actorUserId: admin.user.id,
        action: 'admin.takedown',
        entityType: input.card_id ? 'card' : 'article',
        entityId: input.card_id ?? article.id,
        metadata: {
          articleId: article.id,
          cardId: input.card_id ?? null,
          reason: input.reason ?? null,
        },
      });

      return { articleId: article.id, cardId: input.card_id ?? null };
    });

    return json({ removed: true, ...result });
  });
}
