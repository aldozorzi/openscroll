import { eq } from 'drizzle-orm';
import { users } from '@openscroll/db';
import { clearAuthCookies, requireAuth } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { invalidateFeedCache } from '../../../../lib/feed';
import { handleRoute, json, noContent } from '../../../../lib/http';
import { getProfile } from '../../../../lib/profile';
import { enforceRateLimit } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`me:${session.user.id}`, 120, 60_000);
    return json({ user: await getProfile(db, session.user.id) });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`delete-account:${session.user.id}`, 3, 60_000);

    await db.delete(users).where(eq(users.id, session.user.id));
    await invalidateFeedCache(session.user.id);

    const response = noContent();
    clearAuthCookies(response);
    return response;
  });
}
