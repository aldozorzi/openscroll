'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ApiError, api, isNetworkError } from '../lib/api-client';
import { useLocale } from './providers';

export function ForgotPasswordForm() {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await api('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: { email },
      });
      setSent(true);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.status === 429 ? t('errorRateLimited') : t('errorGeneric'));
      } else if (isNetworkError(caught)) {
        setError(t('errorNetwork'));
      } else {
        setError(t('errorGeneric'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <section className="surface-panel rounded-[2rem] p-6 sm:p-8">
        <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-accent">
          {t('appName')}
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
          {t('resetEmailSentTitle')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">{t('resetEmailSentBody')}</p>
        <Link href="/login" className="btn btn-secondary mt-7 w-full py-3">
          {t('backToSignIn')}
        </Link>
      </section>
    );
  }

  return (
    <section className="surface-panel rounded-[2rem] p-6 sm:p-8">
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.2em] text-accent">
        {t('appName')}
      </p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-ink">
        {t('forgotPasswordTitle')}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        {t('forgotPasswordSubtitle')}
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
          >
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

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn btn-primary w-full py-3">
          {submitting ? t('sendingResetLink') : t('sendResetLink')}
        </button>
      </form>

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
