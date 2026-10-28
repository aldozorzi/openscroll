const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'OpenScroll <onboarding@resend.dev>';

export interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;
  const subject = 'Reset your OpenScroll password';
  const text = [
    'We received a request to reset your OpenScroll password.',
    '',
    `Open this link to choose a new password: ${input.resetUrl}`,
    '',
    `The link expires in ${input.expiresInMinutes} minutes and can only be used once.`,
    'If you did not request a reset, you can ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f1b17;max-width:560px;margin:0 auto">
      <h1 style="font-size:24px;line-height:1.2">Reset your OpenScroll password</h1>
      <p>We received a request to reset your password.</p>
      <p>
        <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#c65d2e;color:#fff;text-decoration:none;font-weight:700">
          Choose a new password
        </a>
      </p>
      <p>The link expires in ${input.expiresInMinutes} minutes and can only be used once.</p>
      <p>If you did not request a reset, you can ignore this email.</p>
    </div>
  `;

  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'password_reset_link',
          email: input.to,
          url: input.resetUrl,
        }),
      );
    } else {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'password_reset_email_not_configured',
        }),
      );
    }
    return false;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'password_reset_email_failed',
          status: response.status,
        }),
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'password_reset_email_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    return false;
  }
}

export interface VerificationEmailInput {
  to: string;
  verifyUrl: string;
  expiresInHours: number;
}

/**
 * Verification email is sent through an optionally separate Resend key and
 * sender, so abuse of registration cannot exhaust the password-reset quota or
 * damage the reputation of the critical transactional stream.
 */
export async function sendVerificationEmail(
  input: VerificationEmailInput,
): Promise<boolean> {
  const apiKey =
    process.env.RESEND_VERIFICATION_API_KEY?.trim() ||
    process.env.RESEND_API_KEY?.trim();
  const from =
    process.env.EMAIL_VERIFICATION_FROM?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    DEFAULT_FROM;
  const subject = 'Verify your OpenScroll email';
  const text = [
    'Confirm your email address to finish creating your OpenScroll account.',
    '',
    `Open this link to verify your email: ${input.verifyUrl}`,
    '',
    `The link expires in ${input.expiresInHours} hours and can only be used once.`,
    'If you did not create an account, you can ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f1b17;max-width:560px;margin:0 auto">
      <h1 style="font-size:24px;line-height:1.2">Verify your OpenScroll email</h1>
      <p>Confirm your email address to finish creating your account.</p>
      <p>
        <a href="${escapeHtml(input.verifyUrl)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#c65d2e;color:#fff;text-decoration:none;font-weight:700">
          Verify email
        </a>
      </p>
      <p>The link expires in ${input.expiresInHours} hours and can only be used once.</p>
      <p>If you did not create an account, you can ignore this email.</p>
    </div>
  `;

  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'email_verification_link',
          email: input.to,
          url: input.verifyUrl,
        }),
      );
      return true;
    }
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'verification_email_not_configured',
      }),
    );
    return false;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject,
        text,
        html,
      }),
    });

    if (!response.ok) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'verification_email_failed',
          status: response.status,
        }),
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'verification_email_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    return false;
  }
}
