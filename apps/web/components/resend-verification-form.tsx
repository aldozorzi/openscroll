'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { ApiError, api, isNetworkError } from '../lib/api-client';
import { useLocale } from './providers';
import { TurnstileWidget } from './turnstile-widget';

/**
 * Small standalone form that asks the server for a new verification email.
 *
 * The endpoint always answers `202`, so the UI shows the same confirmation for
 * every address: it never reveals whether an account exists.
 */
export function ResendVerificationForm({
  defaultEmail = '',
  siteKey = null,
}: {
  defaultEmail?: string;
  siteKey?: string | null;
}) {
  const { t } = useLocale();
  const [email, setEmail] = useState(defaultEmail);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleCaptchaToken = useCallback((token: string | null) => {
    setCaptchaToken(token);
  }, []);

  const resetCaptcha = useCallback(() => {
    setCaptchaToken(null);
    setCaptchaResetKey((key) => key + 1);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError(t('emailRequired'));
      return;
    }
    if (siteKey && !captchaToken) {
      setError(t('captchaRequired'));
      return;
    }

    setStatus('sending');
    try {
      await api('/api/v1/auth/resend-verification', {
        method: 'POST',
        body: {
          email,
          ...(captchaToken ? { captcha_token: captchaToken } : {}),
        },
      });
      setStatus('sent');
      resetCaptcha();
    } catch (caught) {
      // Turnstile tokens are single-use, so a rejected submission always needs
      // a fresh challenge.
      resetCaptcha();
      setStatus('idle');
      if (caught instanceof ApiError) {
        if (caught.status === 429) {
          setError(t('errorRateLimited'));
        } else if (caught.status === 503) {
          setError(t('verificationUnavailable'));
        } else if (caught.status === 400) {
          setError(t('captchaRequired'));
        } else {
          setError(t('errorGeneric'));
        }
      } else if (isNetworkError(caught)) {
        setError(t('errorNetwork'));
      } else {
        setError(t('errorGeneric'));
      }
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
      <div>
        <label
          htmlFor="resend-verification-email"
          className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
        >
          {t('email')}
        </label>
        <input
          id="resend-verification-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="field"
          placeholder="you@example.com"
        />
      </div>

      {siteKey && (
        <TurnstileWidget
          siteKey={siteKey}
          onToken={handleCaptchaToken}
          resetKey={captchaResetKey}
          label={t('captchaLabel')}
          unavailableLabel={t('captchaUnavailable')}
        />
      )}

      {status === 'sent' && (
        <p
          role="status"
          className="rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm text-ink"
        >
          {t('verificationResent')}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="btn btn-secondary w-full py-2.5"
      >
        {status === 'sending'
          ? t('resendingVerification')
          : t('resendVerification')}
      </button>
    </form>
  );
}
