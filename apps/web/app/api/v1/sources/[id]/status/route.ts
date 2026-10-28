import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { articles, sources, userSources } from '@openscroll/db';
import { requireAuth } from '../../../../../../lib/auth';
import { getDb } from '../../../../../../lib/db';
import { handleRoute, HttpError, json } from '../../../../../../lib/http';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';

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
    enforceRateLimit(`source-status:${session.user.id}`, 60, 60_000);

    const { id } = await context.params;
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid source id');
    }

    const [row] = await db
      .select({
        source: sources,
        subscribed: sql<boolean>`${userSources.userId} is not null`,
        articleCount: sql<number>`(
          select count(*)::int from ${articles}
          where ${articles.sourceId} = ${sources.id}
        )`,
        latestError: sql<string | null>`(
          select ${articles.lastError} from ${articles}
          where ${articles.sourceId} = ${sources.id}
            and ${articles.lastError} is not null
          order by ${articles.updatedAt} desc
          limit 1
        )`,
      })
      .from(sources)
      .leftJoin(
        userSources,
        and(
          eq(userSources.sourceId, sources.id),
          eq(userSources.userId, session.user.id),
        ),
      )
      .where(eq(sources.id, parsedId.data))
      .limit(1);

    // Visibility follows ownership only. A stale/subscribed row in user_sources
    // must never grant access to another user's private source.
    if (
      !row ||
      (!row.source.isPublic && row.source.ownerId !== session.user.id)
    ) {
      throw new HttpError(404, 'NOT_FOUND', 'Source not found');
    }

    return json({
      source_id: row.source.id,
      status: row.source.lastFetchedAt
        ? 'ready'
        : row.articleCount > 0
          ? 'ready'
          : 'pending',
      is_active: row.source.isActive,
      subscribed: row.subscribed,
      article_count: row.articleCount,
      last_fetched_at: row.source.lastFetchedAt?.toISOString() ?? null,
      next_fetch_at: row.source.nextFetchAt?.toISOString() ?? null,
      latest_error: row.latestError,
    });
  });
}
