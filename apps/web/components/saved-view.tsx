'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api-client';
import type { SavedCard } from '../lib/types';
import { relativeTime, sourceDomain } from '../lib/utils';
import { BookmarkFilledIcon, BookmarkIcon, ExternalIcon } from './icons';
import { useLocale, useOffline, useToast } from './providers';

function SavedCardView({
  card,
  onUnsave,
}: {
  card: SavedCard;
  onUnsave: () => void;
}) {
  const { t, locale } = useLocale();
  const domain = sourceDomain(card.sourceUrl ?? card.originalUrl);

  return (
    <article className="surface-panel flex flex-col overflow-hidden rounded-[1.8rem] lg:rounded-[2.2rem]">
      <div className="px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
        <header className="flex flex-wrap items-center gap-2">
          {card.topicTags.slice(0, 2).map((tag) => (
            <span key={tag} className="chip chip-active">
              {tag}
            </span>
          ))}
          <span className="chip max-w-40 truncate ms-auto" title={domain}>
            {domain || t('sourceLabel')}
          </span>
        </header>

        <h1 className="mt-6 font-display text-[clamp(1.8rem,5.4vw,2.8rem)] font-semibold leading-[1.08] tracking-tight text-ink">
          {card.hook}
        </h1>

        <p className="mt-5 whitespace-pre-line text-[0.98rem] leading-7 text-ink/90 sm:text-base sm:leading-8">
          {card.coreConcept}
        </p>

        {card.keyTakeaways.length > 0 && (
          <section className="mt-6 rounded-2xl border border-accent/20 bg-accent-soft/45 p-4 sm:p-5">
            <h2 className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-accent">
              {t('takeaway')}
            </h2>
            <ul className="mt-3 space-y-2.5">
              {card.keyTakeaways.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-6 text-ink/90">
                  <BookmarkIcon className="mt-1 h-4 w-4 shrink-0 text-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/70 pt-4 text-xs text-muted">
          {card.sourceTitle && (
            <span className="font-semibold text-ink/80">{card.sourceTitle}</span>
          )}
          {card.publishedAt && (
            <time dateTime={card.publishedAt}>
              {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                new Date(card.publishedAt),
              )}
            </time>
          )}
        </div>
      </div>

      <footer className="border-t border-line bg-elevated/55 px-3 py-2.5 sm:px-5 sm:py-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onUnsave}
            aria-label={t('unsaveCard')}
            className="focus-ring inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition border-accent/40 bg-accent/15 text-accent"
          >
            <BookmarkFilledIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{t('unsaveCard')}</span>
          </button>

          {(card.originalUrl || card.sourceUrl) && (
            <a
              href={card.originalUrl ?? card.sourceUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
              aria-label={t('originalSource')}
              className="focus-ring inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-muted transition hover:border-accent/50 hover:text-ink"
            >
              <ExternalIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{t('originalSource')}</span>
            </a>
          )}
        </div>
      </footer>
    </article>
  );
}

export function SavedView() {
  const { t, locale } = useLocale();
  const { enqueue } = useOffline();
  const { toast } = useToast();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError(false);
    }
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (cursor) {
        params.set('cursor', cursor);
      }
      const data = await api<{ cards: SavedCard[]; nextCursor: string | null }>(
        `/api/v1/me/saved?${params.toString()}`,
      );
      setCards((current) => {
        if (!cursor) {
          return data.cards;
        }
        const known = new Set(current.map((card) => card.id));
        return [...current, ...data.cards.filter((card) => !known.has(card.id))];
      });
      setNextCursor(data.nextCursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const unsaveCard = useCallback(
    async (cardId: string) => {
      try {
        await enqueue(cardId, 'UNSAVE');
        setCards((current) => current.filter((card) => card.id !== cardId));
        toast(t('unsavedToast'), 'success');
      } catch {
        toast(t('errorGeneric'), 'error');
      }
    },
    [enqueue, t, toast],
  );

  const savedLabel = (value: string) =>
    relativeTime(value, locale, {
      today: t('today'),
      yesterday: t('yesterday'),
      daysAgo: (count) => t('daysAgo', { count }),
    });

  return (
    <div className="flex flex-col pb-6">
      <div className="space-y-4">
        {loading && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="skeleton h-64 rounded-3xl" />
            <div className="skeleton h-64 rounded-3xl" />
          </div>
        )}

        {!loading && error && (
          <div className="surface-panel rounded-3xl p-8 text-center">
            <p className="text-sm text-muted">{t('errorGeneric')}</p>
            <button type="button" onClick={() => void load()} className="btn btn-primary mt-4">
              {t('retry')}
            </button>
          </div>
        )}

        {!loading && !error && cards.length === 0 && (
          <div className="surface-panel rounded-3xl p-10 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <h2 className="mt-5 font-display text-3xl font-semibold">
              {t('savedEmptyTitle')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted">{t('savedEmptyBody')}</p>
            <Link href="/feed" className="btn btn-primary mt-6">
              {t('savedBrowseFeed')}
            </Link>
          </div>
        )}

        {!loading && !error && cards.length > 0 && (
          <div className="space-y-4">
            {cards.map((card) => (
              <SavedCardView
                key={card.id}
                card={card}
                onUnsave={() => void unsaveCard(card.id)}
              />
            ))}
          </div>
        )}

        {nextCursor && (
          <button
            type="button"
            onClick={() => void load(nextCursor)}
            disabled={loadingMore}
            className="btn btn-secondary mx-auto"
          >
            {loadingMore ? t('loading') : t('next')}
          </button>
        )}
      </div>
    </div>
  );
}