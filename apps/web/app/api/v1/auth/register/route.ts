import { RegisterSchema } from '@openscroll/contracts';
import { getServerEnv } from '@openscroll/config';
import { hashPassword } from '../../../../../lib/auth';
import { checkRegistrationCaptcha } from '../../../../../lib/captcha';
import { getDb } from '../../../../../lib/db';
import {
  assertSameOrigin,
  getClientIp,
  handleRoute,
  HttpError,
  json,
  parseJson,
} from '../../../../../lib/http';
import { enforceRateLimit } from '../../../../../lib/rate-limit';
import { logSecurityEvent } from '../../../../../lib/security-log';
import {
  isVerificationEmailConfigured,
  scheduleVerificationEmail,
} from '../../../../../lib/verification-email';
import { prepareEmailVerification } from '../../../../../lib/verification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Registration no longer signs the user in. It always answers `202 { ok }`:
 *
 * - a new address gets an unverified account plus a verification email;
 * - an existing unverified address can be re-claimed (new password + link);
 * - an existing verified address is left untouched and gets no email.
 *
 * Because the response is identical in every case, the endpoint can no longer
 * be used to enumerate registered accounts. The account becomes usable only
 * after the link sent to the address is consumed.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    assertSameOrigin(request);

    const ip = getClientIp(request) ?? 'unknown';
    enforceRateLimit(`register:ip:${ip}`, 10, 60_000);

    const input = await parseJson(request, RegisterSchema);

    // Verify the CAPTCHA before touching the users table so a failed challenge
    // cannot be used to probe whether an address is registered.
    const captcha = await checkRegistrationCaptcha(
      input.captcha_token,
      ip === 'unknown' ? null : ip,
    );
    if (captcha.action === 'unavailable') {
      throw new HttpError(
        503,
        'UPSTREAM_ERROR',
        'Registration is temporarily unavailable',
      );
    }
    if (captcha.action === 'reject') {
      logSecurityEvent('auth_register_captcha_failed', {
        ip,
        reason: captcha.reason,
      });
      throw new HttpError(400, 'BAD_REQUEST', 'Unable to create account');
    }

    enforceRateLimit(`register:email:${input.email}`, 10, 15 * 60_000);

    const env = getServerEnv();
    if (env.NODE_ENV === 'production' && !isVerificationEmailConfigured(env)) {
      throw new HttpError(
        503,
        'UPSTREAM_ERROR',
        'Registration is temporarily unavailable',
      );
    }

    // Always pay for the Argon2 hash, even for an address that turns out to be
    // already verified. Hashing only new accounts would make registration
    // measurably faster for existing ones and reintroduce the oracle.
    const passwordHash = await hashPassword(input.password);

    const prepared = await prepareEmailVerification(getDb(), {
      email: input.email,
      passwordHash,
      ip: ip === 'unknown' ? null : ip,
      globalDailyLimit: env.VERIFICATION_EMAIL_DAILY_LIMIT,
    });

    if (prepared.send && prepared.token && prepared.userId) {
      // Send after the response so delivery latency/outcome never becomes an
      // enumeration signal. `after()` keeps the invocation alive on serverless.
      scheduleVerificationEmail({
        requestUrl: request.url,
        email: input.email,
        token: prepared.token,
        userId: prepared.userId,
        ip,
      });
    }

    logSecurityEvent(
      'auth_register_requested',
      {
        ip,
        sent: prepared.send,
        ...(prepared.reason ? { reason: prepared.reason } : {}),
      },
      'info',
    );

    return json({ ok: true }, 202);
  });
}
