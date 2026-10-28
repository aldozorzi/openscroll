import { VerifyEmailSchema } from '@openscroll/contracts';
import {
  createSession,
  setAuthCookies,
} from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';
import {
  assertSameOrigin,
  getClientIp,
  handleRoute,
  HttpError,
  json,
  parseJson,
} from '../../../../../lib/http';
import { getProfile } from '../../../../../lib/profile';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { logSecurityEvent } from '../../../../../lib/security-log';
import { verifyEmailWithToken } from '../../../../../lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    assertSameOrigin(request);

    const ip = getClientIp(request) ?? 'unknown';
    enforceRateLimit(`verify-email:ip:${ip}`, 10, 15 * 60_000);

    const input = await parseJson(request, VerifyEmailSchema);
    const db = getDb();

    let userId: string;
    try {
      userId = await verifyEmailWithToken(db, input.token, input.password);
    } catch (error) {
      logSecurityEvent('auth_email_verification_failed', {
        ip,
        reason: error instanceof HttpError ? error.code : 'unknown',
      });
      throw error;
    }

    logSecurityEvent(
      'auth_email_verification_succeeded',
      { userId, ip },
      'info',
    );

    const session = await createSession(db, userId, request);
    const profile = await getProfile(db, userId);
    const response = json({ user: profile });
    setAuthCookies(response, session);
    return response;
  });
}
