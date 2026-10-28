import { sql } from 'drizzle-orm';
import { ForgotPasswordSchema } from '@openscroll/contracts';
import { users } from '@openscroll/db';
import {
  createPasswordResetToken,
  PASSWORD_RESET_TTL_MS,
} from '../../../../../lib/auth';
import { getDb } from '../../../../../lib/db';
import { runAfterResponse } from '../../../../../lib/background';
import { sendPasswordResetEmail } from '../../../../../lib/email';
import {
  assertSameOrigin,
  getClientIp,
  handleRoute,
  json,
  parseJson,
} from '../../../../../lib/http';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { logSecurityEvent } from '../../../../../lib/security-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    assertSameOrigin(request);

    const ip = getClientIp(request) ?? 'unknown';
    enforceRateLimit(`forgot-password:ip:${ip}`, 5, 15 * 60_000);

    const input = await parseJson(request, ForgotPasswordSchema);
    enforceRateLimit(`forgot-password:email:${input.email}`, 3, 60 * 60_000);

    const db = getDb();
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email}`)
      .limit(1);

    // Only verified addresses may receive a reset link. This prevents an
    // attacker from squatting an address and using the reset flow to mailbomb
    // its real owner.
    if (user?.emailVerifiedAt) {
      logSecurityEvent(
        'auth_password_reset_requested',
        { userId: user.id, ip },
        'info',
      );

      // Do the token write and the email send *after* the response. If this
      // work ran inline, a registered address would take tens/hundreds of
      // milliseconds longer than an unknown one (DB write + email API call),
      // which is a reliable account-enumeration oracle.
      const resetUrl = new URL('/reset-password', request.url);
      runAfterResponse('auth_password_reset_email', async () => {
        const { token } = await createPasswordResetToken(db, user.id);
        resetUrl.searchParams.set('token', token);
        const sent = await sendPasswordResetEmail({
          to: user.email,
          resetUrl: resetUrl.toString(),
          expiresInMinutes: Math.round(PASSWORD_RESET_TTL_MS / 60_000),
        });
        if (!sent) {
          logSecurityEvent(
            'auth_password_reset_email_failed',
            { userId: user.id, ip },
            'error',
          );
        }
      });
    }

    // Always return the same response, whether or not the address exists, so
    // this endpoint cannot be used to enumerate registered accounts.
    return json({ ok: true }, 202);
  });
}
