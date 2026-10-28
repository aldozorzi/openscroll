'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';
import { ApiError, api, isNetworkError } from '../lib/api-client';
import { safeRedirectPath } from '../lib/redirect';
import { useAuth, useLocale, useToast } from './providers';
import { ResendVerificationForm } from './resend-verification-form';
import { TurnstileWidget } from './turnstile-widget';

export function AuthForm({
  mode,
  next = '/feed',
  captchaSiteKey = null,
}: {
  mode: 'login' | 'register';
  next?: string;
  captchaSiteKey?: string | null;
}) {
  const router = useRouter();
  const { refresh } = useAuth();
  const { t } = useLocale();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  // Registration no longer signs the user in: it shows the check-your-inbox
  // panel instead. Login always offers a resend link, independently of the
  // response, so it cannot be used to confirm whether an account exists.
  const [showCheckEmail, setShowCheckEmail] = useState(false);
  const [showResend, setShowResend] = useState(false);

  const isRegister = mode === 'register';
  const showCaptcha = isRegister && Boolean(captchaSiteKey);

  const handleCaptchaToken = useCallback((token: string | null) => {
    setCaptchaToken(token);
  }, []);

  const resetCaptcha = useCallback(() => {
    setCaptchaToken(null);
    setCaptchaResetKey((key) => key + 1);
  }, []);

  // Only allow same-origin absolute paths. Reject protocol-relative ("//evil")
  // and backslash variants that browsers can normalize to another origin.
  const safeNext = safeRedirectPath(next);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError(t('emailRequired'));
      return;
    }
    if (!password) {
      setError(t('passwordRequired'));
      return;
    }
    if (isRegister && password.length < 12) {
      setError(t('weakPassword'));
      return;
    }

    setSubmitting(true);
    try {
      await api(`/api/v1/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        body: {
          email,
          password,
          ...(showCaptcha && captchaToken ? { captcha_token: captchaToken } : {}),
        },
      });

      if (isRegister) {
        // Turnstile tokens are single-use. The confirmation panel has its own
        // widget for a possible resend.
        resetCaptcha();
        setShowCheckEmail(true);
        return;
      }

      await refresh();
      toast(t('welcomeBack'), 'success');
      router.replace(safeNext);
    } catch (caught) {
      if (isRegister) {
        // Turnstile tokens are single-use and expire after a few minutes.
        // Always request a fresh challenge after a failed registration.
        resetCaptcha();
      }
      if (caught instanceof ApiError) {
        if (caught.status === 401) {
          setError(t('invalidCredentials'));
        } else if (caught.status === 400) {
          setError(isRegister ? t('registrationFailed') : t('invalidCredentials'));
        } else if (caught.status === 429) {
          setError(t('errorRateLimited'));
        } else if (caught.status === 503 && isRegister) {
          setError(t('registrationUnavailable'));
        } else {
          setError(caught.message || t('errorGeneric'));
        }
      } else if (isNetworkError(caught)) {
        setError(t('errorNetwork'));
      } else {
        setError(t('errorGeneric'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (showCheckEmail) {
    return (
      <section className="surface-panel rounded-[2rem] p-6 sm:p-8">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-accent">
          {t('appName')}
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
          {t('checkEmailTitle')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {t('checkEmailBody', { email })}
        </p>

        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink">
            {t('resendVerification')}
          </p>
          <ResendVerificationForm
            defaultEmail={email}
            siteKey={captchaSiteKey}
          />
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          <Link
            href="/login"
            className="focus-ring rounded font-semibold text-accent underline-offset-4 hover:underline"
          >
            {t('backToSignIn')}
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="surface-panel rounded-[2rem] p-6 sm:p-8">
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-accent">
        {t('appName')}
      </p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {isRegister ? t('createAccountTitle') : t('signInTitle')}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        {isRegister ? t('createAccountSubtitle') : t('signInSubtitle')}
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted">
            {t('email')}
          </label>
          <input
            id="email"
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

        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted">
            {t('password')}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            minLength={isRegister ? 12 : 1}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
            placeholder="••••••••••••"
            aria-describedby={isRegister ? 'password-hint' : undefined}
            aria-invalid={Boolean(error)}
          />
          {isRegister && (
            <p id="password-hint" className="mt-1.5 text-xs text-muted">
              {t('passwordHint')}
            </p>
          )}
        </div>

        {showCaptcha && captchaSiteKey && (
          <TurnstileWidget
            siteKey={captchaSiteKey}
            onToken={handleCaptchaToken}
            resetKey={captchaResetKey}
            label={t('captchaLabel')}
            unavailableLabel={t('captchaUnavailable')}
          />
        )}

        {!isRegister && (
          <div className="text-right">
            <Link
              href="/forgot-password"
              className="focus-ring rounded text-xs font-semibold text-accent underline-offset-4 hover:underline"
            >
              {t('forgotPassword')}
            </Link>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn btn-primary w-full py-3">
          {submitting
            ? isRegister
              ? t('registering')
              : t('signingIn')
            : isRegister
              ? t('register')
              : t('signIn')}
        </button>
      </form>

      {!isRegister && (
        <div className="mt-5">
          {showResend ? (
            <div className="rounded-2xl border border-line bg-elevated/60 p-4">
              <p className="text-sm leading-6 text-ink">
                {t('emailVerificationRequired')}
              </p>
              <ResendVerificationForm
                defaultEmail={email}
                siteKey={captchaSiteKey}
              />
            </div>
          ) : (
            <p className="text-center text-xs text-muted">
              <button
                type="button"
                onClick={() => setShowResend(true)}
                className="focus-ring rounded font-semibold text-accent underline-offset-4 hover:underline"
              >
                {t('needVerificationEmail')}
              </button>
            </p>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        {isRegister ? t('haveAccount') : t('noAccount')}{' '}
        <Link
          href={isRegister ? '/login' : '/register'}
          className="focus-ring rounded font-semibold text-accent underline-offset-4 hover:underline"
        >
          {isRegister ? t('signIn') : t('createAccount')}
        </Link>
      </p>
    </section>
  );
}
