'use client';

import { SavedView } from '../../../components/saved-view';
import { useLocale } from '../../../components/providers';

export function SavedPageClient() {
  const { t } = useLocale();
  return (
    <div className="px-3 sm:px-6 lg:px-10">
      <header className="pt-4 pb-3 sm:pt-6 lg:pt-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-accent">
              OpenScroll
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {t('savedTitle')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
              {t('savedSubtitle')}
            </p>
          </div>
        </div>
      </header>
      <SavedView />
    </div>
  );
}