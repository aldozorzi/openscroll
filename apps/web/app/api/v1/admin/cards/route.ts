import { z } from 'zod';
import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { articles, cards } from '@openscroll/db';
import { requireAdmin } from '../../../../../lib/admin';
import { recordAuditEvent } from '../../../../../lib/audit';
import { getDb } from '../../../../../lib/db';
import { handleRoute, HttpError, json, parseJson } from '../../../../../lib/http';
import { enqueueJob } from '../../../../../lib/queue';
import { articleSingletonKey } from '@openscroll/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CardStatusEnum = z.enum(['published', 'hidden', 'archived']);
const CardListQuerySchema = z.object({
  status: CardStatusEnum.optional(),
  article_id: z.uuid().optional(),
  search: z.string().trim().max(200).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    await requireAdmin(request, db);
    const { searchParams } = new URL(request.url);
    const query = CardListQuerySchema.parse(Object.fromEntries(searchParams));

    const whereConditions = [];
    if (query.status) whereConditions.push(eq(cards.status, query.status));
    if (query.article_id) whereConditions.push(eq(cards.articleId, query.article_id));
    if (query.search) whereConditions.push(ilike(cards.hook, `%${query.search}%`));
    if (query.from) whereConditions.push(gte(cards.createdAt, new Date(query.from)));
    if (query.to) whereConditions.push(lte(cards.createdAt, new Date(query.to)));

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const [items, total] = await Promise.all([
      db
        .select({
          id: cards.id,
          articleId: cards.articleId,
          hook: cards.hook,
          coreConcept: cards.coreConcept,
          keyTakeaways: cards.keyTakeaways,
          estimatedReadTimeSec: cards.estimatedReadTimeSec,
          embeddingModel: cards.embeddingModel,
          embeddingDim: cards.embeddingDim,
          topicTags: cards.topicTags,
          language: cards.language,
          generationModel: cards.generationModel,
          promptVersion: cards.promptVersion,
          status: cards.status,
          hasEmbedding: sql<boolean>`${cards.embedding} IS NOT NULL`,
          createdAt: cards.createdAt,
          updatedAt: cards.updatedAt,
        })
        .from(cards)
        .where(whereClause)
        .orderBy(desc(cards.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(cards)
        .where(whereClause),
    ]);

    return json({
      items,
      total: total[0]?.count ?? 0,
      limit: query.limit,
      offset: query.offset,
    });
  });
}

const CardActionSchema = z.object({
  card_id: z.uuid(),
  action: z.enum(['regenerate', 'hide', 'publish', 'delete']),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const admin = await requireAdmin(request, db);
    const input = await parseJson(request, CardActionSchema);

    const [card] = await db
      .select()
      .from(cards)
      .where(eq(cards.id, input.card_id))
      .limit(1);

    if (!card) {
      throw new HttpError(404, 'NOT_FOUND', 'Card not found');
    }

    switch (input.action) {
      case 'regenerate': {
        // Reset article to processing to trigger new card generation
        await db
          .update(articles)
          .set({
            status: 'processing',
            updatedAt: new Date(),
          })
          .where(eq(articles.id, card.articleId));

        // Delete existing card so generate-card creates a new one
        await db.delete(cards).where(eq(cards.id, card.id));

        const jobId = await enqueueJob(
          'generate-card',
          { articleId: card.articleId },
          { singletonKey: articleSingletonKey(card.articleId) },
        );

        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.card.regenerate',
          entityType: 'card',
          entityId: card.id,
          metadata: { articleId: card.articleId, jobId },
        });

        return json({ action: 'regenerate', cardId: card.id, articleId: card.articleId, jobId, message: 'Card deleted, article reset to processing, re-queued for generation' }, 202);
      }

      case 'hide': {
        await db
          .update(cards)
          .set({ status: 'hidden', updatedAt: new Date() })
          .where(eq(cards.id, card.id));
        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.card.hide',
          entityType: 'card',
          entityId: card.id,
          metadata: { previousStatus: card.status },
        });

        return json({ action: 'hide', cardId: card.id, message: 'Card hidden from feed' });
      }

      case 'publish': {
        await db
          .update(cards)
          .set({ status: 'published', updatedAt: new Date() })
          .where(eq(cards.id, card.id));
        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.card.publish',
          entityType: 'card',
          entityId: card.id,
          metadata: { previousStatus: card.status },
        });

        return json({ action: 'publish', cardId: card.id, message: 'Card published to feed' });
      }

      case 'delete': {
        await db.delete(cards).where(eq(cards.id, card.id));

        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.card.delete',
          entityType: 'card',
          entityId: card.id,
          metadata: { articleId: card.articleId, previousStatus: card.status },
        });

        return json({ action: 'delete', cardId: card.id, message: 'Card deleted' });
      }
    }
  });
}