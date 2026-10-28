'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, api, isNetworkError } from '../lib/api-client';
import { useAuth, useLocale, useToast } from './providers';
import { ResendVerificationForm } from './resend-verification-form';

/**
 * Consumes the one-time token from the verification link. The token is only
 * exchanged when the user presses the button, so mail scanners that pre-open
 * links cannot activate the account or burn the token.
 */
export function VerifyEmailForm({
  token,
  siteKey = null,
}: {
  token: string;
  siteKey?: string | null;
}) {
  const router = useRouter();
  const { refresh } = useAuth();
  const { t } = useLocale();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!password) {
      setError(t('passwordRequired'));
      return;
    }

    setSubmitting(true);

    try {
      const body = await api<{
        user: { preferences: { topics: string[] } | null };
      }>('/api/v1/auth/verify-email', {
        method: 'POST',
        body: { token, password },
      });
      await refresh();
      toast(t('verifyEmailDone'), 'success');
      const hasTopics = Boolean(body.user.preferences?.topics.length);
      router.replace(hasTopics ? '/feed' : '/onboarding');
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 400) {
          setError(t('verifyEmailInvalid'));
        } else if (caught.status === 429) {
          setError(t('errorRateLimited'));
        } else {
          setError(t('errorGeneric'));
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

  if (!token) {
    return (
      <section className="surface-panel rounded-[2rem] p-6 sm:p-8">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-accent">
          {t('appName')}
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
          {t('verifyEmailTitle')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {t('verifyEmailMissing')}
        </p>
        <ResendVerificationForm siteKey={siteKey} />
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
        {t('verifyEmailTitle')}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        {t('verifyEmailSubtitle')}
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <div>
          <label
            htmlFor="verify-email-password"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
          >
            {t('password')}
          </label>
          <input
            id="verify-email-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
            placeholder="••••••••••••"
            aria-describedby="verify-email-password-hint"
            aria-invalid={Boolean(error)}
          />
          <p id="verify-email-password-hint" className="mt-1.5 text-xs text-muted">
            {t('verifyEmailPasswordHint')}
          </p>
        </div>

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
          disabled={submitting}
          className="btn btn-primary w-full py-3"
        >
          {submitting ? t('verifyingEmail') : t('verifyEmail')}
        </button>
      </form>

      {error && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink">
            {t('resendVerification')}
          </p>
          <ResendVerificationForm siteKey={siteKey} />
        </div>
      )}

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
