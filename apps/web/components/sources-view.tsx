'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api-client';
import type { SourceSummary } from '../lib/types';
import { cn, relativeTime, sourceDomain } from '../lib/utils';
import {
  CheckIcon,
  ExternalIcon,
  PlusIcon,
  SourcesIcon,
  TrashIcon,
} from './icons';
import { PageHeading } from './page-heading';
import { useAuth, useLocale, useToast } from './providers';
import { SourceAddForm } from './source-add-form';

function SourceRow({
  source,
  onChanged,
  onDeleted,
}: {
  source: SourceSummary;
  onChanged: (source: SourceSummary) => void;
  onDeleted: (id: string) => void;
}) {
  const { t, locale } = useLocale();
  const { toast } = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const isOwner = Boolean(user && source.owner_id === user.id);
  const pending = !source.last_fetched_at && (source.article_count ?? 0) === 0;
  const domain = sourceDomain(source.url);

  const toggleSubscription = async () => {
    setBusy(true);
    try {
      if (source.subscribed) {
        await api(`/api/v1/sources/${source.id}/subscribe`, { method: 'DELETE' });
        onChanged({ ...source, subscribed: false });
      } else {
        await api(`/api/v1/sources/${source.id}/subscribe`, { method: 'POST' });
        onChanged({ ...source, subscribed: true });
      }
    } catch {
      toast(t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t('deleteSourceConfirm'))) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/v1/sources/${source.id}`, { method: 'DELETE' });
      toast(t('deleteSource'), 'success');
      onDeleted(source.id);
    } catch {
      toast(t('errorGeneric'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const fetchedLabel = source.last_fetched_at
    ? t('lastFetched', {
        time: relativeTime(source.last_fetched_at, locale, {
          today: t('today'),
          yesterday: t('yesterday'),
          daysAgo: (count) => t('daysAgo', { count }),
        }),
      })
    : t('neverFetched');

  return (
    <article className="surface-panel rounded-2xl p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent/15 font-display text-lg font-bold uppercase text-accent">
          {source.title.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate font-semibold text-ink">{source.title}</h3>
            <span className="chip">{source.source_type.replace('_', ' ')}</span>
            <span className="chip">
              {pending ? t('statusPending') : t('statusReady')}
            </span>
            {source.is_public ? (
              <span className="chip">{t('publicSource')}</span>
            ) : (
              <span className="chip">{t('privateSource')}</span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="focus-ring inline-flex max-w-full items-center gap-1 rounded font-medium text-muted hover:text-ink"
            >
              <span className="truncate">{domain}</span>
              <ExternalIcon className="h-3 w-3 shrink-0" />
            </a>
            <span>{t('articleCount', { count: source.article_count ?? 0 })}</span>
            <span>{fetchedLabel}</span>
            {source.category && <span>{source.category}</span>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void toggleSubscription()}
              disabled={busy}
              className={cn(
                'btn px-3 py-1.5 text-xs',
                source.subscribed ? 'btn-secondary' : 'btn-primary',
              )}
            >
              {source.subscribed ? (
                <>
                  <CheckIcon className="h-3.5 w-3.5" />
                  {t('subscribed')}
                </>
              ) : (
                <>
                  <PlusIcon className="h-3.5 w-3.5" />
                  {t('subscribe')}
                </>
              )}
            </button>
            {source.subscribed && (
              <button
                type="button"
                onClick={() => void toggleSubscription()}
                disabled={busy}
                className="focus-ring rounded-full px-2 py-1.5 text-xs font-semibold text-muted hover:text-ink"
              >
                {t('unsubscribe')}
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="focus-ring ms-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-danger"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                {t('deleteSource')}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function SourcesView() {
  const { t } = useLocale();
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'subscribed'>('all');
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
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) {
        params.set('cursor', cursor);
      }
      const data = await api<{
        sources: SourceSummary[];
        nextCursor: string | null;
      }>(`/api/v1/sources?${params.toString()}`);
      setSources((current) => {
        if (!cursor) {
          return data.sources;
        }
        const known = new Set(current.map((source) => source.id));
        return [...current, ...data.sources.filter((source) => !known.has(source.id))];
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

  const addSources = (incoming: SourceSummary[]) => {
    setSources((current) => {
      const byId = new Map(current.map((source) => [source.id, source]));
      for (const source of incoming) {
        byId.set(source.id, { ...byId.get(source.id), ...source });
      }
      return [...byId.values()];
    });
  };

  const visible = sources.filter(
    (source) => filter === 'all' || source.subscribed,
  );

  return (
    <div className="flex flex-col pb-6">
      <PageHeading
        eyebrow={t('sourcesTitle')}
        titleKey="sourcesTitle"
        subtitleKey="sourcesSubtitle"
        icon={SourcesIcon}
      />
      <div className="space-y-4 px-4 sm:px-6 lg:px-10">
        <SourceAddForm
          onAdded={(source) => addSources([source])}
          onImported={(imported) => addSources(imported)}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-full border border-line bg-surface/70 p-1">
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
              className={cn(
                'focus-ring rounded-full px-3 py-1.5 text-xs font-semibold transition',
                filter === 'all'
                  ? 'bg-accent text-accent-ink'
                  : 'text-muted hover:text-ink',
              )}
            >
              {t('filterAll')}
            </button>
            <button
              type="button"
              onClick={() => setFilter('subscribed')}
              aria-pressed={filter === 'subscribed'}
              className={cn(
                'focus-ring rounded-full px-3 py-1.5 text-xs font-semibold transition',
                filter === 'subscribed'
                  ? 'bg-accent text-accent-ink'
                  : 'text-muted hover:text-ink',
              )}
            >
              {t('filterSubscribed')}
            </button>
          </div>
          <span className="text-xs text-muted">
            {t('sourceCount', { count: visible.length })}
          </span>
        </div>

        {loading && (
          <div className="space-y-3">
            <div className="skeleton h-32 w-full rounded-2xl" />
            <div className="skeleton h-32 w-full rounded-2xl" />
          </div>
        )}

        {!loading && error && (
          <div className="surface-panel rounded-2xl p-8 text-center">
            <p className="text-sm text-muted">{t('errorGeneric')}</p>
            <button type="button" onClick={() => void load()} className="btn btn-primary mt-4">
              {t('retry')}
            </button>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="surface-panel rounded-2xl p-8 text-center">
            <p className="font-display text-2xl font-semibold">{t('sourcesEmpty')}</p>
            <p className="mt-2 text-sm text-muted">{t('addSourceHint')}</p>
          </div>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="grid gap-3">
            {visible.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                onChanged={(next) =>
                  setSources((current) =>
                    current.map((item) => (item.id === next.id ? next : item)),
                  )
                }
                onDeleted={(id) =>
                  setSources((current) => current.filter((item) => item.id !== id))
                }
              />
            ))}
          </div>
        )}

        {nextCursor && filter === 'all' && (
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
