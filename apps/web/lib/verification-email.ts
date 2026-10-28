import { getServerEnv } from '@openscroll/config';
import { runAfterResponse } from './background';
import { sendVerificationEmail } from './email';
import { logSecurityEvent } from './security-log';
import { EMAIL_VERIFICATION_TTL_MS } from './verification';

export function isVerificationEmailConfigured(
  env = getServerEnv(),
): boolean {
  return Boolean(env.RESEND_VERIFICATION_API_KEY || env.RESEND_API_KEY);
}

/**
 * Schedule the verification email after the HTTP response. Delivery latency
 * and provider failures must not become an account-enumeration signal.
 */
export function scheduleVerificationEmail(input: {
  requestUrl: string;
  email: string;
  token: string;
  userId: string;
  ip: string;
}): void {
  const verifyUrl = new URL('/verify-email', input.requestUrl);
  verifyUrl.searchParams.set('token', input.token);

  runAfterResponse('auth_email_verification_email', async () => {
    const sent = await sendVerificationEmail({
      to: input.email,
      verifyUrl: verifyUrl.toString(),
      expiresInHours: Math.round(
        EMAIL_VERIFICATION_TTL_MS / (60 * 60 * 1000),
      ),
    });
    if (!sent) {
      logSecurityEvent(
        'auth_email_verification_failed',
        { userId: input.userId, ip: input.ip },
        'error',
      );
    }
  });
}
