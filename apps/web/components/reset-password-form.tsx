'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, api, isNetworkError } from '../lib/api-client';
import { useAuth, useLocale, useToast } from './providers';

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const { t } = useLocale();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError(t('weakPassword'));
      return;
    }
    if (password !== confirmation) {
      setError(t('passwordsDoNotMatch'));
      return;
    }

    setSubmitting(true);
    try {
      await api('/api/v1/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      await refresh();
      toast(t('passwordResetDone'), 'success');
      router.replace('/feed');
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 400) {
          setError(t('resetLinkInvalid'));
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
          {t('resetPasswordTitle')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">{t('resetLinkMissing')}</p>
        <Link href="/forgot-password" className="btn btn-primary mt-7 w-full py-3">
          {t('requestNewResetLink')}
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
        {t('resetPasswordTitle')}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        {t('resetPasswordSubtitle')}
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <div>
          <label
            htmlFor="new-password"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
          >
            {t('newPassword')}
          </label>
          <input
            id="new-password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="field"
            placeholder="••••••••••••"
            aria-describedby="password-hint"
            aria-invalid={Boolean(error)}
          />
          <p id="password-hint" className="mt-1.5 text-xs text-muted">
            {t('passwordHint')}
          </p>
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
          >
            {t('confirmPassword')}
          </label>
          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="field"
            placeholder="••••••••••••"
            aria-invalid={Boolean(error)}
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
          {submitting ? t('resettingPassword') : t('resetPassword')}
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
