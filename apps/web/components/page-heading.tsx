'use client';

import type { ComponentType, ReactNode, SVGProps } from 'react';
import { useLocale } from './providers';
import type { TranslationKey } from '../lib/i18n';

export function PageHeading({
  eyebrow,
  titleKey,
  subtitleKey,
  icon: Icon,
  action,
}: {
  eyebrow?: string;
  titleKey: TranslationKey;
  subtitleKey?: TranslationKey;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  action?: ReactNode;
}) {
  const { t } = useLocale();

  return (
    <header className="shrink-0 px-4 pb-4 pt-4 sm:px-6 lg:px-10 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="inline-flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-[0.2em] text-accent">
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {eyebrow}
            </p>
          )}
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {t(titleKey)}
          </h1>
          {subtitleKey && (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              {t(subtitleKey)}
            </p>
          )}
        </div>
        {action}
      </div>
    </header>
  );
}
