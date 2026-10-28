import { ResetPasswordSchema } from '@openscroll/contracts';
import {
  createSession,
  hashPassword,
  resetPasswordWithToken,
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    assertSameOrigin(request);

    const ip = getClientIp(request) ?? 'unknown';
    enforceRateLimit(`reset-password:ip:${ip}`, 10, 15 * 60_000);

    const input = await parseJson(request, ResetPasswordSchema);
    const db = getDb();

    let userId: string;
    try {
      userId = await resetPasswordWithToken(db, input.token, input.password);
    } catch (error) {
      // A valid token costs one Argon2 hash plus the update transaction. Burn
      // the same hash on the invalid path so response timing does not reveal
      // whether a reset token is valid/expired.
      if (error instanceof HttpError && error.status === 400) {
        await hashPassword(input.password);
      }
      logSecurityEvent('auth_password_reset_failed', {
        ip,
        reason: error instanceof HttpError ? error.code : 'unknown',
      });
      throw error;
    }

    logSecurityEvent(
      'auth_password_reset_succeeded',
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
