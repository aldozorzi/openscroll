import { sql } from 'drizzle-orm';
import { LoginSchema } from '@openscroll/contracts';
import { users } from '@openscroll/db';
import {
  createSession,
  setAuthCookies,
  verifyPasswordConstantTime,
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
    enforceRateLimit(`login:ip:${ip}`, 10, 60_000);

    const input = await parseJson(request, LoginSchema);
    // Per-account throttle: an attacker rotating IPs still cannot brute-force a
    // single inbox faster than this, and a victim cannot be locked out from
    // other accounts by a shared-IP bucket.
    enforceRateLimit(`login:email:${input.email}`, 10, 15 * 60_000);

    const db = getDb();
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        hashedPassword: users.hashedPassword,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);

    // Runs a full Argon2 verification even for unknown accounts so response
    // timing does not reveal whether the email is registered.
    const passwordValid = await verifyPasswordConstantTime(
      user?.hashedPassword,
      input.password,
    );

    if (!user || !passwordValid) {
      logSecurityEvent('auth_login_failed', {
        email: input.email,
        ip,
        reason: user ? 'invalid_password' : 'unknown_account',
      });
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    // Unverified accounts must not be usable, but returning a distinct 403
    // here would let an attacker register an address with a password of their
    // choice and then probe login: 403 means the password took effect (address
    // was not verified), 401 means it did not (address was already verified).
    // Use the same generic response as a bad password instead. The UI always
    // offers a resend link, so legitimate unverified users still have a path.
    if (!user.emailVerifiedAt) {
      logSecurityEvent('auth_login_unverified', {
        userId: user.id,
        ip,
      });
      throw new HttpError(401, 'UNAUTHORIZED', 'Invalid email or password');
    }

    const session = await createSession(db, user.id, request);
    const profile = await getProfile(db, user.id);
    logSecurityEvent(
      'auth_login_succeeded',
      { userId: user.id, ip, role: profile.role },
      'info',
    );

    const response = json({ user: profile });
    setAuthCookies(response, session);
    return response;
  });
}
