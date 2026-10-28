import type { Metadata } from 'next';
import { getServerEnv } from '@openscroll/config';
import { VerifyEmailForm } from '../../../components/verify-email-form';

export const metadata: Metadata = {
  title: 'Verify your email',
};

// The Turnstile site key (used by the resend form) is read from the server
// environment per request, so the widget does not depend on a build-time
// NEXT_PUBLIC variable.
export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const siteKey = getServerEnv().TURNSTILE_SITE_KEY ?? null;
  return <VerifyEmailForm token={token ?? ''} siteKey={siteKey} />;
}
