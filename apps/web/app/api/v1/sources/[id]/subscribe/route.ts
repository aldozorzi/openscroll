import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { sources, userSources } from '@openscroll/db';
import { requireAuth } from '../../../../../../lib/auth';
import { getDb } from '../../../../../../lib/db';
import { handleRoute, HttpError, json, noContent } from '../../../../../../lib/http';
import { invalidateFeedCache } from '../../../../../../lib/feed';
import { enforceRateLimit } from '../../../../../../lib/rate-limit';
import {
  canSubscribeToSource,
  subscribeToSource,
  unsubscribeFromSource,
} from '../../../../../../lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function loadSource(context: RouteContext) {
  const { id } = await context.params;
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid source id');
  }
  return parsedId.data;
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`subscribe:${session.user.id}`, 60, 60_000);
    const sourceId = await loadSource(context);

    const [source] = await db
      .select({ id: sources.id, isPublic: sources.isPublic, ownerId: sources.ownerId })
      .from(sources)
      .where(eq(sources.id, sourceId))
      .limit(1);
    if (!source || !canSubscribeToSource(source, session.user.id)) {
      throw new HttpError(404, 'NOT_FOUND', 'Source not found');
    }

    await subscribeToSource(db, session.user.id, source.id);
    await invalidateFeedCache(session.user.id);
    return json({ source_id: source.id, subscribed: true });
  });
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`unsubscribe:${session.user.id}`, 60, 60_000);
    const sourceId = await loadSource(context);

    await unsubscribeFromSource(db, session.user.id, sourceId);
    await invalidateFeedCache(session.user.id);
    return noContent();
  });
}
