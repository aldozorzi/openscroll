'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { SOURCE_URL } from '../lib/constants';
import { cn } from '../lib/utils';
import { Brand } from './brand';
import {
  CodeIcon,
  FeedIcon,
  LogoutIcon,
  ReviewIcon,
  SavedIcon,
  SettingsIcon,
  ShieldIcon,
  SourcesIcon,
  SyncIcon,
} from './icons';
import { useAuth, useLocale, useOffline } from './providers';
import { ThemeToggle } from './theme-toggle';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const navigation: Array<{
  href: string;
  key:
    | 'navFeed'
    | 'navReview'
    | 'navSaved'
    | 'navSources'
    | 'navSettings'
    | 'navAdmin';
  icon: IconComponent;
}> = [
  { href: '/feed', key: 'navFeed', icon: FeedIcon },
  { href: '/review', key: 'navReview', icon: ReviewIcon },
  { href: '/saved', key: 'navSaved', icon: SavedIcon },
  { href: '/sources', key: 'navSources', icon: SourcesIcon },
  { href: '/settings', key: 'navSettings', icon: SettingsIcon },
];

const adminNavigation = {
  href: '/admin',
  key: 'navAdmin' as const,
  icon: ShieldIcon,
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function LoadingShell() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm space-y-4">
        <div className="skeleton h-12 w-12 rounded-2xl" />
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-56 w-full rounded-3xl" />
      </div>
    </div>
  );
}

function OfflineBanner() {
  const { t } = useLocale();
  const { online, pending, flush } = useOffline();

  if (online && pending === 0) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-accent-soft/70 px-4 py-2 text-xs text-ink lg:px-8"
    >
      <span className="font-semibold">
        {online ? t('pendingCount', { count: pending }) : t('errorNetwork')}
      </span>
      <button
        type="button"
        onClick={() => flush().catch(() => undefined)}
        disabled={!online || pending === 0}
        className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-line/80 bg-surface/60 px-3 py-1 font-semibold disabled:opacity-50"
      >
        <SyncIcon className="h-3.5 w-3.5" />
        {t('syncNow')}
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, user, signOut } = useAuth();
  const { t } = useLocale();

  useEffect(() => {
    if (status === 'guest') {
      const next = encodeURIComponent(pathname || '/feed');
      router.replace(`/login?next=${next}`);
    }
  }, [pathname, router, status]);

  if (status === 'loading') {
    return <LoadingShell />;
  }

  if (status === 'guest' || !user) {
    return <LoadingShell />;
  }

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  const items = user.role === 'admin' ? [...navigation, adminNavigation] : navigation;

  return (
    <div className="h-dvh overflow-hidden lg:flex">
      <a href="#main-content" className="skip-link">
        {t('skipToContent')}
      </a>

      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-line bg-surface/70 px-4 py-5 backdrop-blur-xl lg:flex">
        <Brand className="px-2" />

        <nav aria-label={t('mainNavigation')} className="mt-8 flex flex-col gap-1">
          {items.map(({ href, key, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-ring group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition',
                  active
                    ? 'bg-accent/15 text-accent'
                    : 'text-muted hover:bg-ink/5 hover:text-ink',
                )}
              >
                <Icon className="h-[1.15rem] w-[1.15rem]" />
                {t(key)}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-3">
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
            className="focus-ring flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-muted transition hover:text-ink"
          >
            <CodeIcon className="h-4 w-4" />
            {t('sourceCode')}
          </a>

          <div className="rounded-2xl border border-line bg-elevated/70 p-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-black uppercase text-accent">
                {user.email.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink">{user.email}</p>
                <p className="truncate text-[0.68rem] text-muted">{user.role}</p>
              </div>
              <ThemeToggle compact />
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="focus-ring mt-3 flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-semibold text-muted transition hover:bg-ink/5 hover:text-ink"
            >
              <LogoutIcon className="h-4 w-4" />
              {t('signOut')}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex h-dvh min-w-0 flex-col lg:ms-64">
        <header className="safe-top flex shrink-0 items-center justify-between border-b border-line/70 bg-surface/65 px-4 pb-3 backdrop-blur-xl lg:hidden">
          <Brand compact />
          <div className="flex items-center gap-2">
            <a
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
              className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-line bg-surface/80 text-muted transition hover:text-ink"
              aria-label={t('sourceCode')}
              title={t('sourceCode')}
            >
              <CodeIcon className="h-4 w-4" />
            </a>
            <ThemeToggle compact />
            <Link
              href="/settings"
              className="focus-ring grid h-9 w-9 place-items-center rounded-full bg-accent/15 text-xs font-black uppercase text-accent"
              aria-label={t('navSettings')}
            >
              {user.email.slice(0, 1)}
            </Link>
          </div>
        </header>

        <OfflineBanner />

        <main
          id="main-content"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[calc(4.8rem+env(safe-area-inset-bottom))] lg:pb-0 lg:w-3xl"
        >
          {children}
        </main>

        <nav
          aria-label={t('mainNavigation')}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/92 px-2 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden"
        >
          <div className="mx-auto flex max-w-lg items-stretch justify-between">
            {items.map(({ href, key, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'focus-ring flex min-w-14 flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-[0.65rem] font-semibold transition',
                    active ? 'text-accent' : 'text-muted',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {t(key)}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
