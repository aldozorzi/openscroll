import type { Metadata } from 'next';
import { getServerEnv } from '@openscroll/config';
import { AuthForm } from '../../../components/auth-form';

export const metadata: Metadata = {
  title: 'Create account',
};

// The Turnstile site key is read from the server environment per request, so
// the widget does not depend on a build-time NEXT_PUBLIC variable.
export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  const siteKey = getServerEnv().TURNSTILE_SITE_KEY ?? null;
  return <AuthForm mode="register" captchaSiteKey={siteKey} />;
}
