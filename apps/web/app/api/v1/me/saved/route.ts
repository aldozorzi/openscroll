import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { MAX_CURSOR_LENGTH } from '@openscroll/contracts';
import {
  articles,
  cards,
  sources,
  userInteractions,
} from '@openscroll/db';
import { requireAuth } from '../../../../../lib/auth';
import { accessibleSourceCondition } from '../../../../../lib/card-access';
import { decodeTimeCursor, encodeTimeCursor } from '../../../../../lib/cursor';
import { getDb } from '../../../../../lib/db';
import { handleRoute, json } from '../../../../../lib/http';
import { enforceRateLimit } from '../../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SavedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
});

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`saved:${session.user.id}`, 60, 60_000);

    const url = new URL(request.url);
    const query = SavedQuerySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });
    const cursor = query.cursor ? decodeTimeCursor(query.cursor) : null;

    const rows = await db
      .select({
        interactionId: userInteractions.id,
        savedAt: userInteractions.createdAt,
        id: cards.id,
        articleId: cards.articleId,
        hook: cards.hook,
        coreConcept: cards.coreConcept,
        keyTakeaways: cards.keyTakeaways,
        topicTags: cards.topicTags,
        language: cards.language,
        estimatedReadTimeSec: cards.estimatedReadTimeSec,
        publishedAt: articles.publishedAt,
        originalUrl: articles.canonicalUrl,
        sourceTitle: sources.title,
        sourceUrl: sources.url,
      })
      .from(userInteractions)
      .innerJoin(cards, eq(cards.id, userInteractions.cardId))
      .innerJoin(articles, eq(articles.id, cards.articleId))
      .leftJoin(sources, eq(sources.id, articles.sourceId))
      .where(
        and(
          eq(userInteractions.userId, session.user.id),
          eq(userInteractions.interactionType, 'SAVE'),
          accessibleSourceCondition(session.user.id),
          cursor
            ? sql`(${userInteractions.createdAt}, ${userInteractions.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(userInteractions.createdAt), desc(userInteractions.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return json({
      cards: page.map((row) => ({
        id: row.id,
        articleId: row.articleId,
        hook: row.hook,
        coreConcept: row.coreConcept,
        keyTakeaways: row.keyTakeaways,
        topicTags: row.topicTags,
        language: row.language,
        estimatedReadTimeSec: row.estimatedReadTimeSec,
        sourceTitle: row.sourceTitle,
        sourceUrl: row.sourceUrl,
        originalUrl: row.originalUrl,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        score: 0,
        saved_at: row.savedAt.toISOString(),
      })),
      nextCursor:
        hasMore && last
          ? encodeTimeCursor({
              createdAt: last.savedAt.toISOString(),
              id: last.interactionId,
            })
          : null,
    });
  });
}
