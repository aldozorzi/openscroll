import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { sources, userSources } from '@openscroll/db';
import { requireAuth } from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';
import {
  handleRoute,
  HttpError,
  json,
} from '../../../../../lib/http';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { serializeSource } from '../../../../../lib/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`source-delete:${session.user.id}`, 20, 60_000);

    const { id } = await context.params;
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid source id');
    }

    const [source] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, parsedId.data))
      .limit(1);
    if (!source) {
      throw new HttpError(404, 'NOT_FOUND', 'Source not found');
    }
    // A public source is shared infrastructure: deleting it removes cards for
    // every subscriber and stops ingestion for everyone. Only admins may do
    // that. Owners can always delete their own private sources.
    if (source.isPublic && session.user.role !== 'admin') {
      throw new HttpError(
        403,
        'FORBIDDEN',
        'Only an admin can delete a public source',
      );
    }
    if (source.ownerId !== session.user.id && session.user.role !== 'admin') {
      // Do not confirm the existence of another user's private source.
      throw new HttpError(404, 'NOT_FOUND', 'Source not found');
    }

    await db.delete(sources).where(eq(sources.id, source.id));
    return json({ deleted: true, source: serializeSource(source, false) });
  });
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`source-detail:${session.user.id}`, 60, 60_000);

    const { id } = await context.params;
    const parsedId = z.uuid().safeParse(id);
    if (!parsedId.success) {
      throw new HttpError(400, 'BAD_REQUEST', 'Invalid source id');
    }

    const [source] = await db
      .select()
      .from(sources)
      .where(eq(sources.id, parsedId.data))
      .limit(1);
    if (!source) {
      throw new HttpError(404, 'NOT_FOUND', 'Source not found');
    }
    if (!source.isPublic && source.ownerId !== session.user.id) {
      throw new HttpError(404, 'NOT_FOUND', 'Source not found');
    }

    const [subscription] = await db
      .select({ userId: userSources.userId })
      .from(userSources)
      .where(
        and(
          eq(userSources.userId, session.user.id),
          eq(userSources.sourceId, source.id),
        ),
      )
      .limit(1);

    return json({
      source: serializeSource(source, Boolean(subscription)),
    });
  });
}
