import { FeedQuerySchema } from '@openscroll/contracts';
import { requireAuth } from '../../../../lib/auth';
import { getDb } from '../../../../lib/db';
import { getFeed } from '../../../../lib/feed';
import { handleRoute, json } from '../../../../lib/http';
import { enforceRateLimit } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    enforceRateLimit(`feed:${session.user.id}`, 120, 60_000);

    const query = FeedQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const page = await getFeed(db, session.user.id, session.createdAt, query);
    return json(page);
  });
}
