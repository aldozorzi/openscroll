import { z } from 'zod';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { MAX_CURSOR_LENGTH, SourceInputSchema } from '@openscroll/contracts';
import { articles, sources, userSources } from '@openscroll/db';
import { canonicalizeAndHash, discoverFeed } from '@openscroll/ingest';
import { sourceSingletonKey } from '@openscroll/queue';
import { requireAuth } from '../../../../lib/auth';
import { decodeTimeCursor, encodeTimeCursor } from '../../../../lib/cursor';
import { getDb } from '../../../../lib/db';
import { handleRoute, HttpError, json, parseJson } from '../../../../lib/http';
import { enqueueSafely } from '../../../../lib/queue';
import { enforceRateLimit } from '../../../../lib/rate-limit';
import {
  serializeSource,
  sourceTypeFromContentType,
  subscribeToSource,
  upsertSource,
} from '../../../../lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SourcesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`sources:${session.user.id}`, 60, 60_000);

    const url = new URL(request.url);
    const query = SourcesQuerySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });
    const cursor = query.cursor ? decodeTimeCursor(query.cursor) : null;

    const rows = await db
      .select({
        source: sources,
        subscribed: sql<boolean>`${userSources.userId} is not null`,
        articleCount: sql<number>`(
          select count(*)::int from ${articles}
          where ${articles.sourceId} = ${sources.id}
        )`,
      })
      .from(sources)
      .leftJoin(
        userSources,
        sql`${userSources.sourceId} = ${sources.id} and ${userSources.userId} = ${session.user.id}`,
      )
      .where(
        and(
          or(
            eq(sources.isPublic, true),
            eq(sources.ownerId, session.user.id),
          ),
          cursor
            ? sql`(${sources.createdAt}, ${sources.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(sources.createdAt), desc(sources.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return json({
      sources: page.map((row) =>
        serializeSource(row.source, row.subscribed, row.articleCount),
      ),
      nextCursor:
        hasMore && last
          ? encodeTimeCursor({
              createdAt: last.source.createdAt.toISOString(),
              id: last.source.id,
            })
          : null,
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`source-create:${session.user.id}`, 10, 60_000);

    const input = await parseJson(request, SourceInputSchema);
    const discovered = await discoverFeed(input.url);
    if (!discovered) {
      throw new HttpError(400, 'BAD_REQUEST', 'No feed was found at this URL');
    }

    const { url } = canonicalizeAndHash(discovered.url);
    // `upsertSource` scopes private feeds by owner, so every user may add the
    // same private feed URL and get their own independent row. The only
    // exception is an existing public source: that row is shared on purpose.
    const source = await upsertSource(db, {
      url,
      title: input.title ?? new URL(url).hostname,
      sourceType: sourceTypeFromContentType(discovered.contentType),
      ownerId: session.user.id,
      isPublic: false,
      category: input.category ?? null,
    });

    await subscribeToSource(db, session.user.id, source.id);
    const jobId = await enqueueSafely(
      'ingest-source',
      { sourceId: source.id },
      { singletonKey: sourceSingletonKey(source.id) },
    );

    return json(
      {
        jobId,
        sourceId: source.id,
        status: 'queued',
        source: serializeSource(source, true),
      },
      202,
    );
  });
}
