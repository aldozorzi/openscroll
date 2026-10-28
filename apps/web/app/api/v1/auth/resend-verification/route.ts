import { getServerEnv } from '@openscroll/config';
import { ResendVerificationSchema } from '@openscroll/contracts';
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
 * Ask for a new verification link. The response is always `202 { ok: true }`:
 * unknown addresses and already-verified accounts are indistinguishable from a
 * pending one. The database budget and the per-address cooldown decide whether
 * an email actually leaves.
 */
export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async () => {
    assertSameOrigin(request);

    const ip = getClientIp(request) ?? 'unknown';
    enforceRateLimit(`resend-verification:ip:${ip}`, 5, 15 * 60_000);

    const input = await parseJson(request, ResendVerificationSchema);

    const captcha = await checkRegistrationCaptcha(
      input.captcha_token,
      ip === 'unknown' ? null : ip,
    );
    if (captcha.action === 'unavailable') {
      throw new HttpError(
        503,
        'UPSTREAM_ERROR',
        'Verification email is temporarily unavailable',
      );
    }
    if (captcha.action === 'reject') {
      logSecurityEvent('auth_resend_verification_captcha_failed', {
        ip,
        reason: captcha.reason,
      });
      throw new HttpError(400, 'BAD_REQUEST', 'Unable to send verification email');
    }

    enforceRateLimit(
      `resend-verification:email:${input.email}`,
      3,
      60 * 60_000,
    );

    const env = getServerEnv();
    if (env.NODE_ENV === 'production' && !isVerificationEmailConfigured(env)) {
      throw new HttpError(
        503,
        'UPSTREAM_ERROR',
        'Verification email is temporarily unavailable',
      );
    }

    const prepared = await prepareEmailVerification(getDb(), {
      email: input.email,
      passwordHash: null,
      ip: ip === 'unknown' ? null : ip,
      globalDailyLimit: env.VERIFICATION_EMAIL_DAILY_LIMIT,
    });

    if (prepared.send && prepared.token && prepared.userId) {
      scheduleVerificationEmail({
        requestUrl: request.url,
        email: input.email,
        token: prepared.token,
        userId: prepared.userId,
        ip,
      });
    }

    logSecurityEvent(
      'auth_resend_verification_requested',
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
