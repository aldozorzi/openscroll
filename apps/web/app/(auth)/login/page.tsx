import type { Metadata } from 'next';
import { getServerEnv } from '@openscroll/config';
import { AuthForm } from '../../../components/auth-form';

export const metadata: Metadata = {
  title: 'Sign in',
};

// The Turnstile site key is needed when an unverified account asks for a new
// verification link from the login screen.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const siteKey = getServerEnv().TURNSTILE_SITE_KEY ?? null;
  return <AuthForm mode="login" next={next} captchaSiteKey={siteKey} />;
}
