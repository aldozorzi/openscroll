'use client';

import type { FeedCard } from '@openscroll/contracts';
import { cn, sourceDomain } from '../lib/utils';
import {
  BookmarkFilledIcon,
  BookmarkIcon,
  CheckIcon,
  ExternalIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from './icons';
import { useLocale } from './providers';

export function CardView({
  card,
  saved,
  reviewBusy,
  onSave,
  onLike,
  onDislike,
  onSchedule,
  onSourceClick,
}: {
  card: FeedCard;
  saved: boolean;
  reviewBusy: boolean;
  onSave: () => void;
  onLike: () => void;
  onDislike: () => void;
  onSchedule: (intervalDays: 1 | 3 | 7 | 14) => void;
  onSourceClick: () => void;
}) {
  const { t, locale } = useLocale();

  const domain = sourceDomain(card.sourceUrl ?? card.originalUrl);

  const reviewIntervals = [
    { days: 1, key: 'reviewIn1Day' as const },
    { days: 3, key: 'reviewIn3Days' as const },
    { days: 7, key: 'reviewIn7Days' as const },
    { days: 14, key: 'reviewIn14Days' as const },
  ];

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
                  <CheckIcon className="mt-1 h-4 w-4 shrink-0 text-accent" />
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
            onClick={onLike}
            className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-ink/5 hover:text-ink"
            aria-label={t('likeCard')}
            title={t('likeCard')}
          >
            <ThumbUpIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onDislike}
            className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-ink/5 hover:text-ink"
            aria-label={t('dislikeCard')}
            title={t('dislikeCard')}
          >
            <ThumbDownIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={onSave}
            disabled={saved}
            aria-pressed={saved}
            aria-label={saved ? t('savedCard') : t('saveCard')}
            className={cn(
              'focus-ring inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition',
              saved
                ? 'border-accent/40 bg-accent/15 text-accent'
                : 'border-line text-muted hover:border-accent/50 hover:text-ink',
            )}
          >
            {saved ? (
              <BookmarkFilledIcon className="h-4 w-4" />
            ) : (
              <BookmarkIcon className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{saved ? t('savedCard') : t('saveCard')}</span>
          </button>

          {(card.originalUrl || card.sourceUrl) && (
            <a
              href={card.originalUrl ?? card.sourceUrl ?? '#'}
              target="_blank"
              rel="noreferrer"
              onClick={onSourceClick}
              aria-label={t('originalSource')}
              className="focus-ring inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-muted transition hover:border-accent/50 hover:text-ink"
            >
              <ExternalIcon className="h-4 w-4" />
              <span className="hidden sm:inline">{t('originalSource')}</span>
            </a>
          )}

        </div>

        <div className="mt-2 border-t border-line/60 pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="hidden text-[0.65rem] font-bold uppercase tracking-[0.14em] text-muted sm:block">
              {t('reviewIn')}
            </span>
            <div
              className="grid flex-1 grid-cols-4 gap-1.5 sm:max-w-md"
              role="group"
              aria-label={t('reviewBar')}
            >
              {reviewIntervals.map((interval) => (
                <button
                  key={interval.days}
                  type="button"
                  disabled={reviewBusy}
                  onClick={() => onSchedule(interval.days as 1 | 3 | 7 | 14)}
                  className="focus-ring rounded-full border bg-surface/70 px-1.5 py-1.5 text-[0.68rem] font-bold transition hover:bg-ink/5"
                  aria-label={`${t('reviewIn')} ${t(interval.key)}`}
                >
                  {t(interval.key)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </article>
  );
}