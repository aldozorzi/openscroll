import {
  requireAuth,
  rotateSession,
  setAuthCookies,
} from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';
import { handleRoute, json } from '../../../../../lib/http';
import { getProfile } from '../../../../../lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    const db = getDb();
    const session = await requireAuth(request, db);
    const rotated = await rotateSession(db, session);
    const profile = await getProfile(db, session.user.id);
    const response = json({ user: profile });
    setAuthCookies(response, rotated);
    return response;
  });
}
