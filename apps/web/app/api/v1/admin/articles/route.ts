import { z } from 'zod';
import { and, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
import { articles } from '@openscroll/db';
import { articleSingletonKey } from '@openscroll/queue';
import { requireAdmin } from '../../../../../lib/admin';
import { recordAuditEvent } from '../../../../../lib/audit';
import { getDb } from '../../../../../lib/db';
import { handleRoute, HttpError, json, parseJson } from '../../../../../lib/http';
import { enqueueJob } from '../../../../../lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ArticleStatusEnum = z.enum(['pending', 'fetching', 'processing', 'ready', 'skipped', 'failed']);
const ArticleListQuerySchema = z.object({
  status: ArticleStatusEnum.optional(),
  source_id: z.uuid().optional(),
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
    const query = ArticleListQuerySchema.parse(Object.fromEntries(searchParams));

    const whereConditions = [];
    if (query.status) whereConditions.push(eq(articles.status, query.status));
    if (query.source_id) whereConditions.push(eq(articles.sourceId, query.source_id));
    if (query.search) whereConditions.push(ilike(articles.title, `%${query.search}%`));
    if (query.from) whereConditions.push(gte(articles.createdAt, new Date(query.from)));
    if (query.to) whereConditions.push(lte(articles.createdAt, new Date(query.to)));

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const [items, total] = await Promise.all([
      db
        .select({
          id: articles.id,
          sourceId: articles.sourceId,
          title: articles.title,
          originalUrl: articles.originalUrl,
          canonicalUrl: articles.canonicalUrl,
          status: articles.status,
          attempts: articles.attempts,
          lastError: articles.lastError,
          publishedAt: articles.publishedAt,
          createdAt: articles.createdAt,
          updatedAt: articles.updatedAt,
          retentionExpiresAt: articles.retentionExpiresAt,
          hasRawContent: sql<boolean>`${articles.rawContent} IS NOT NULL`,
          hasCleanedContent: sql<boolean>`${articles.cleanedContent} IS NOT NULL`,
          contentHash: articles.contentHash,
        })
        .from(articles)
        .where(whereClause)
        .orderBy(desc(articles.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(articles)
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

const SingleArticleActionSchema = z.object({
  article_id: z.uuid(),
  action: z.enum(['retry', 'skip', 'delete']),
});

const BulkArticleActionSchema = z.object({
  action: z.enum(['retry_failed', 'delete_failed']),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const ArticleActionSchema = z.discriminatedUnion('action', [
  SingleArticleActionSchema,
  BulkArticleActionSchema,
]);

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const admin = await requireAdmin(request, db);
    const input = await parseJson(request, ArticleActionSchema);

    if (input.action === 'retry_failed') {
      const failed = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.status, 'failed'))
        .limit(input.limit);

      let queued = 0;
      for (const article of failed) {
        await db
          .update(articles)
          .set({
            status: 'pending',
            attempts: 0,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(articles.id, article.id));

        const jobId = await enqueueJob(
          'process-article',
          { articleId: article.id },
          { singletonKey: articleSingletonKey(article.id) },
        );
        if (jobId) {
          queued += 1;
        }
      }

      await recordAuditEvent(db, {
        actorUserId: admin.user.id,
        action: 'admin.article.retry_failed',
        entityType: 'article',
        metadata: { matched: failed.length, queued, limit: input.limit },
      });

      return json(
        { action: 'retry_failed', matched: failed.length, queued },
        202,
      );
    }

    if (input.action === 'delete_failed') {
      const failed = await db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.status, 'failed'))
        .limit(input.limit);

      if (failed.length > 0) {
        await db.delete(articles).where(
          inArray(
            articles.id,
            failed.map((article) => article.id),
          ),
        );
      }

      await recordAuditEvent(db, {
        actorUserId: admin.user.id,
        action: 'admin.article.delete_failed',
        entityType: 'article',
        metadata: { deleted: failed.length, limit: input.limit },
      });

      return json({ action: 'delete_failed', deleted: failed.length });
    }

    // Narrow the discriminated union to the single-article branches. The two
    // bulk actions above always return, but an explicit guard makes that clear
    // to the type checker as well.
    if (
      input.action !== 'retry' &&
      input.action !== 'skip' &&
      input.action !== 'delete'
    ) {
      throw new HttpError(400, 'BAD_REQUEST', 'Unsupported action');
    }

    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.article_id))
      .limit(1);

    if (!article) {
      throw new HttpError(404, 'NOT_FOUND', 'Article not found');
    }

    switch (input.action) {
      case 'retry': {
        // Reset to pending and re-enqueue process-article
        await db
          .update(articles)
          .set({
            status: 'pending',
            attempts: 0,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(articles.id, article.id));

        const jobId = await enqueueJob(
          'process-article',
          { articleId: article.id },
          { singletonKey: articleSingletonKey(article.id) },
        );

        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.article.retry',
          entityType: 'article',
          entityId: article.id,
          metadata: { previousStatus: article.status, jobId },
        });

        return json({ action: 'retry', articleId: article.id, jobId, message: 'Article reset to pending and re-queued for processing' }, 202);
      }

      case 'skip': {
        await db
          .update(articles)
          .set({
            status: 'skipped',
            lastError: 'Manually skipped by admin',
            rawContent: null,
            cleanedContent: null,
            updatedAt: new Date(),
          })
          .where(eq(articles.id, article.id));

        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.article.skip',
          entityType: 'article',
          entityId: article.id,
          metadata: { previousStatus: article.status, title: article.title },
        });

        return json({ action: 'skip', articleId: article.id, message: 'Article marked as skipped, content cleared' });
      }

      case 'delete': {
        await db.delete(articles).where(eq(articles.id, article.id));

        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.article.delete',
          entityType: 'article',
          entityId: article.id,
          metadata: { previousStatus: article.status, title: article.title },
        });

        return json({ action: 'delete', articleId: article.id, message: 'Article deleted' });
      }
    }
  });
}