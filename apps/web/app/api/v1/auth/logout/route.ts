import { requireAuth, revokeSession, clearAuthCookies } from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';
import { handleRoute, noContent } from '../../../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    await revokeSession(db, session.sessionId);
    const response = noContent();
    clearAuthCookies(response);
    return response;
  });
}
