import { z } from 'zod';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { SOURCE_TYPES } from '@openscroll/contracts';
import { sources, articles } from '@openscroll/db';
import { sourceSingletonKey } from '@openscroll/queue';
import { requireAdmin } from '../../../../../lib/admin';
import { recordAuditEvent } from '../../../../../lib/audit';
import { getDb } from '../../../../../lib/db';
import { handleRoute, HttpError, json, parseJson } from '../../../../../lib/http';
import { enqueueJob } from '../../../../../lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SourceTypeEnum = z.enum(SOURCE_TYPES);
const BooleanQueryParam = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');
const SourceListQuerySchema = z.object({
  // Never use z.coerce.boolean(): the string "false" is truthy there.
  is_active: BooleanQueryParam.optional(),
  source_type: SourceTypeEnum.optional(),
  category: z.string().trim().max(100).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    await requireAdmin(request, db);
    const { searchParams } = new URL(request.url);
    const query = SourceListQuerySchema.parse(Object.fromEntries(searchParams));

    const whereConditions = [];
    if (query.is_active !== undefined) whereConditions.push(eq(sources.isActive, query.is_active));
    if (query.source_type) whereConditions.push(eq(sources.sourceType, query.source_type));
    if (query.category) whereConditions.push(eq(sources.category, query.category));
    if (query.search) whereConditions.push(ilike(sources.title, `%${query.search}%`));

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const [items, total] = await Promise.all([
      db
        .select({
          id: sources.id,
          title: sources.title,
          url: sources.url,
          sourceType: sources.sourceType,
          category: sources.category,
          isPublic: sources.isPublic,
          isActive: sources.isActive,
          etag: sources.etag,
          lastModified: sources.lastModified,
          fetchIntervalMinutes: sources.fetchIntervalMinutes,
          nextFetchAt: sources.nextFetchAt,
          lastFetchedAt: sources.lastFetchedAt,
          consecutiveFailures: sources.consecutiveFailures,
          lastFailureAt: sources.lastFailureAt,
          lastError: sources.lastError,
          createdAt: sources.createdAt,
          updatedAt: sources.updatedAt,
          articlesCount: sql<number>`(
            SELECT count(*)::int FROM ${articles} WHERE ${articles.sourceId} = ${sources.id}
          )`,
        })
        .from(sources)
        .where(whereClause)
        .orderBy(desc(sources.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(sources)
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

const SourceActionSchema = z.object({
  source_id: z.uuid(),
  action: z.enum(['activate', 'deactivate', 'ingest', 'reset_failures', 'update_interval']),
  fetch_interval_minutes: z.coerce.number().int().positive().max(10080).optional(), // max 1 week
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const admin = await requireAdmin(request, db);
    const input = await parseJson(request, SourceActionSchema);

    const [source] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, input.source_id))
      .limit(1);

    if (!source) {
      throw new HttpError(404, 'NOT_FOUND', 'Source not found');
    }

    switch (input.action) {
      case 'activate': {
        await db
          .update(sources)
          .set({
            isActive: true,
            nextFetchAt: new Date(), // schedule immediately
            updatedAt: new Date(),
          })
          .where(eq(sources.id, source.id));
        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.source.activate',
          entityType: 'source',
          entityId: source.id,
        });

        return json({ action: 'activate', sourceId: source.id, message: 'Source activated and scheduled for immediate ingest' });
      }

      case 'deactivate': {
        await db
          .update(sources)
          .set({
            isActive: false,
            nextFetchAt: null,
            updatedAt: new Date(),
          })
          .where(eq(sources.id, source.id));
        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.source.deactivate',
          entityType: 'source',
          entityId: source.id,
        });

        return json({ action: 'deactivate', sourceId: source.id, message: 'Source deactivated, removed from schedule' });
      }

      case 'ingest': {
        const jobId = await enqueueJob(
          'ingest-source',
          { sourceId: source.id },
          { singletonKey: sourceSingletonKey(source.id) },
        );
        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.source.ingest',
          entityType: 'source',
          entityId: source.id,
          metadata: { jobId },
        });
        return json({ action: 'ingest', sourceId: source.id, jobId, message: 'Ingest job queued' }, 202);
      }

      case 'reset_failures': {
        await db
          .update(sources)
          .set({
            consecutiveFailures: 0,
            lastFailureAt: null,
            lastError: null,
            isActive: true, // also reactivate if it was auto-deactivated
            nextFetchAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(sources.id, source.id));
        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.source.reset_failures',
          entityType: 'source',
          entityId: source.id,
          metadata: {
            previousFailures: source.consecutiveFailures,
            previousError: source.lastError,
          },
        });

        return json({ action: 'reset_failures', sourceId: source.id, message: 'Failure counters reset, source reactivated and scheduled' });
      }

      case 'update_interval': {
        if (!input.fetch_interval_minutes) {
          throw new HttpError(400, 'BAD_REQUEST', 'fetch_interval_minutes required for update_interval action');
        }
        await db
          .update(sources)
          .set({
            fetchIntervalMinutes: input.fetch_interval_minutes,
            nextFetchAt: new Date(), // reschedule with new interval
            updatedAt: new Date(),
          })
          .where(eq(sources.id, source.id));
        await recordAuditEvent(db, {
          actorUserId: admin.user.id,
          action: 'admin.source.update_interval',
          entityType: 'source',
          entityId: source.id,
          metadata: {
            previousInterval: source.fetchIntervalMinutes,
            nextInterval: input.fetch_interval_minutes,
          },
        });

        return json({ action: 'update_interval', sourceId: source.id, message: `Fetch interval updated to ${input.fetch_interval_minutes} minutes` });
      }
    }
  });
}