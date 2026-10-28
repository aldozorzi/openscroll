'use client';

import type { ReactNode } from 'react';
import { SOURCE_URL } from '../lib/constants';
import { Brand } from './brand';
import { CodeIcon, SparkIcon } from './icons';
import { LocaleSwitcher } from './locale-switcher';
import { useLocale } from './providers';
import { ThemeToggle } from './theme-toggle';

export function AuthFrame({ children }: { children: ReactNode }) {
  const { t } = useLocale();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-e border-line bg-surface/55 p-10 lg:flex lg:flex-col">
        <Brand />
        <div className="my-auto max-w-md py-16">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-elevated/60 px-3 py-1 text-[0.7rem] font-bold uppercase tracking-[0.18em] text-accent">
            <SparkIcon className="h-3.5 w-3.5" />
            {t('appTagline')}
          </p>
          <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.04] tracking-tight text-ink">
            Turn the endless scroll into something worth remembering.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted">
            Open feeds. Short, useful cards. Personal recommendations and spaced
            review that help ideas stay with you.
          </p>

          <div aria-hidden="true" className="relative mt-12 h-56 max-w-sm">
            <div className="absolute inset-x-10 top-0 h-40 rotate-[-5deg] rounded-3xl border border-line bg-canvas/70" />
            <div className="absolute inset-x-5 top-5 h-44 rotate-[2deg] rounded-3xl border border-line bg-elevated/80" />
            <div className="absolute inset-x-0 top-11 rounded-3xl border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.16em] text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                machine learning · 3 min
              </div>
              <p className="mt-4 font-display text-xl font-semibold leading-snug">
                Why do neural networks forget what they learned?
              </p>
              <p className="mt-3 text-xs leading-5 text-muted">
                Catastrophic interference happens when new weights overwrite old
                representations…
              </p>
              <div className="mt-4 flex gap-2">
                <span className="h-8 flex-1 rounded-full bg-accent/15" />
                <span className="h-8 w-8 rounded-full bg-accent/15" />
                <span className="h-8 w-8 rounded-full bg-accent/15" />
              </div>
            </div>
          </div>
        </div>
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex w-fit items-center gap-2 text-xs font-semibold text-muted transition hover:text-ink"
        >
          <CodeIcon className="h-4 w-4" />
          {t('sourceCode')}
        </a>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="safe-top flex items-center justify-between px-5 pb-4 lg:justify-end lg:px-8">
          <Brand className="lg:hidden" />
          <div className="flex items-center gap-2">
            <LocaleSwitcher compact />
            <ThemeToggle compact />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-5 pb-12 sm:px-8">
          <div className="w-full max-w-md animate-rise">{children}</div>
        </main>
      </div>
    </div>
  );
}
