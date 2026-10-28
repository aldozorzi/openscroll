'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedMode, FeedResponse } from '@openscroll/contracts';
import { ApiError, api } from '../lib/api-client';
import type { CardDetail, SavedCard } from '../lib/types';
import { cn, newIdempotencyKey } from '../lib/utils';
import { CardView } from './card-view';
import { SparkIcon } from './icons';
import { useLocale, useOffline, useToast } from './providers';

const ESTIMATED_CARD_HEIGHT = 576;
const OVERSCAN_PX = 900;
const LOAD_MORE_DISTANCE = 700;

type FeedCard = FeedResponse['cards'][number];

function FeedSkeleton() {
  return (
    <div className="surface-panel flex min-h-[26rem] flex-col rounded-[1.8rem] p-5 sm:p-7 lg:rounded-[2.2rem]">
      <div className="flex gap-2">
        <div className="skeleton h-6 w-20 rounded-full" />
        <div className="skeleton h-6 w-24 rounded-full" />
        <div className="skeleton ms-auto h-6 w-16 rounded-full" />
      </div>
      <div className="skeleton mt-7 h-12 w-11/12" />
      <div className="skeleton mt-3 h-12 w-4/5" />
      <div className="mt-7 space-y-2.5">
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-5/6" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-2/3" />
      </div>
      <div className="skeleton mt-7 h-32 w-full rounded-2xl" />
      <div className="mt-auto pt-6">
        <div className="skeleton h-10 w-full rounded-full" />
      </div>
    </div>
  );
}

function FeedCardSlot({
  card,
  active,
  saved,
  reviewBusy,
  onMeasure,
  onSave,
  onLike,
  onDislike,
  onSchedule,
  onSourceClick,
}: {
  card: FeedCard;
  active: boolean;
  saved: boolean;
  reviewBusy: boolean;
  onMeasure: (cardId: string, height: number, node: HTMLElement) => void;
  onSave: () => void;
  onLike: () => void;
  onDislike: () => void;
  onSchedule: (intervalDays: 1 | 3 | 7 | 14) => void;
  onSourceClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const measure = () => onMeasure(card.id, node.offsetHeight, node);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [card.id, onMeasure]);

  return (
    <div
      ref={ref}
      data-feed-card={card.id}
      data-feed-active={active ? 'true' : undefined}
      className="pb-4"
    >
      <CardView
        card={card}
        saved={saved}
        reviewBusy={reviewBusy}
        onSave={onSave}
        onLike={onLike}
        onDislike={onDislike}
        onSchedule={onSchedule}
        onSourceClick={onSourceClick}
      />
    </div>
  );
}

export function FeedDeck({
  fixedMode,
  children,
}: {
  fixedMode?: FeedMode;
  children?: React.ReactNode;
}) {
  const { t } = useLocale();
  const { toast } = useToast();
  const { online, enqueue } = useOffline();

  const activeMode: FeedMode = fixedMode ?? 'mixed';
  const [cards, setCards] = useState<FeedResponse['cards']>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'loadingMore' | 'error'>(
    'loading',
  );
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [measureVersion, setMeasureVersion] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

  const cursorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const loadingRef = useRef(false);
  const pendingScrollIndexRef = useRef<number | null>(null);
  const heightsRef = useRef(new Map<string, number>());
  const listRef = useRef<HTMLDivElement>(null);
  const scrollParentRef = useRef<HTMLElement | null>(null);
  const listTopRef = useRef(0);

  const readListTop = useCallback((parent: HTMLElement) => {
    const list = listRef.current;
    if (!list) {
      return listTopRef.current;
    }
    const top =
      list.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop;
    listTopRef.current = top;
    return top;
  }, []);

  const updateViewport = useCallback(() => {
    const parent = scrollParentRef.current;
    if (!parent) {
      return;
    }
    const listTop = readListTop(parent);
    setViewport({
      top: Math.max(0, parent.scrollTop - listTop),
      height: parent.clientHeight,
    });
  }, [readListTop]);

  useEffect(() => {
    const parent = listRef.current?.closest('main') as HTMLElement | null;
    scrollParentRef.current = parent;
    setScrollParent(parent);
  }, []);

  useEffect(() => {
    if (!scrollParent) {
      return;
    }
    updateViewport();
    scrollParent.addEventListener('scroll', updateViewport, { passive: true });
    window.addEventListener('resize', updateViewport);
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scrollParent);
    return () => {
      scrollParent.removeEventListener('scroll', updateViewport);
      window.removeEventListener('resize', updateViewport);
      observer.disconnect();
    };
  }, [scrollParent, updateViewport]);

  const layout = useMemo(() => {
    const offsets: number[] = [];
    const heights: number[] = [];
    let total = 0;
    for (const card of cards) {
      const height = heightsRef.current.get(card.id) ?? ESTIMATED_CARD_HEIGHT;
      offsets.push(total);
      heights.push(height);
      total += height;
    }
    return { offsets, heights, total };
  }, [cards, measureVersion]);

  const activeIndex = useMemo(() => {
    if (cards.length === 0) {
      return 0;
    }
    const probe = viewport.top + Math.min(48, viewport.height / 3);
    for (let index = 0; index < layout.offsets.length; index += 1) {
      if (layout.offsets[index]! + layout.heights[index]! > probe) {
        return index;
      }
    }
    return cards.length - 1;
  }, [cards.length, layout, viewport]);

  const range = useMemo(() => {
    if (cards.length === 0) {
      return { start: 0, end: 0 };
    }
    const startEdge = Math.max(0, viewport.top - OVERSCAN_PX);
    const endEdge = viewport.top + viewport.height + OVERSCAN_PX;
    let start = 0;
    while (
      start < cards.length &&
      layout.offsets[start]! + layout.heights[start]! < startEdge
    ) {
      start += 1;
    }
    if (start >= cards.length) {
      start = cards.length - 1;
    }
    let end = start;
    while (end < cards.length && layout.offsets[end]! < endEdge) {
      end += 1;
    }
    if (end <= start) {
      end = Math.min(cards.length, start + 1);
    }
    return { start, end };
  }, [cards.length, layout, viewport]);

  const topSpacer = cards.length > 0 ? layout.offsets[range.start]! ?? 0 : 0;
  const renderedEnd =
    cards.length > 0 && range.end > range.start
      ? layout.offsets[range.end - 1]! + layout.heights[range.end - 1]!
      : 0;
  const bottomSpacer = cards.length > 0 ? Math.max(0, layout.total - renderedEnd) : 0;
  const active = cards[activeIndex];

  const scrollToIndex = useCallback(
    (target: number, behavior: ScrollBehavior = 'smooth') => {
      const parent = scrollParentRef.current;
      if (!parent) {
        return;
      }
      const listTop = readListTop(parent);
      const top = Math.max(0, listTop + (layout.offsets[target] ?? 0) - 12);
      parent.scrollTo({ top, behavior });
    },
    [layout.offsets, readListTop],
  );

  const measureCard = useCallback(
    (cardId: string, height: number, node: HTMLElement) => {
      const nextHeight = Math.max(1, Math.round(height));
      const previous = heightsRef.current.get(cardId) ?? ESTIMATED_CARD_HEIGHT;
      if (previous === nextHeight) {
        return;
      }
      const parent = scrollParentRef.current;
      if (parent) {
        const parentTop = parent.getBoundingClientRect().top;
        if (node.getBoundingClientRect().top < parentTop) {
          parent.scrollTop += nextHeight - previous;
        }
      }
      heightsRef.current.set(cardId, nextHeight);
      setMeasureVersion((current) => current + 1);
    },
    [],
  );

  const loadFeed = useCallback(
    async (targetMode: FeedMode, reset: boolean) => {
      if (!reset && loadingRef.current) {
        return;
      }
      const requestId = ++requestIdRef.current;
      loadingRef.current = true;
      if (reset) {
        setStatus('loading');
        setCards([]);
        setError(null);
        setEnded(false);
        cursorRef.current = null;
        pendingScrollIndexRef.current = null;
        heightsRef.current.clear();
        setMeasureVersion((current) => current + 1);
        scrollParentRef.current?.scrollTo({ top: 0 });
      } else {
        setStatus('loadingMore');
      }

      try {
        const params = new URLSearchParams({ mode: targetMode, limit: '10' });
        if (!reset && cursorRef.current) {
          params.set('cursor', cursorRef.current);
        }
        const data = await api<FeedResponse>(`/api/v1/feed?${params.toString()}`);
        if (requestId !== requestIdRef.current) {
          return;
        }
        cursorRef.current = data.nextCursor;
        setEnded(!data.nextCursor);
        setCards((current) => {
          if (reset) {
            return data.cards;
          }
          const known = new Set(current.map((card) => card.id));
          return [...current, ...data.cards.filter((card) => !known.has(card.id))];
        });
        setStatus('ready');
      } catch (caught) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        const message =
          caught instanceof ApiError
            ? caught.status === 429
              ? t('errorRateLimited')
              : caught.status === 401
                ? t('errorUnauthorized')
                : t('feedLoadError')
            : t('feedLoadError');
        setError(message);
        setStatus('error');
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
        }
      }
    },
    [t],
  );

  useEffect(() => {
    void loadFeed(activeMode, true);
  }, [activeMode, loadFeed]);

  useEffect(() => {
    if (status !== 'ready' || !cursorRef.current || loadingRef.current) {
      return;
    }
    if (viewport.top + viewport.height < layout.total - LOAD_MORE_DISTANCE) {
      return;
    }
    void loadFeed(activeMode, false);
  }, [activeMode, layout.total, loadFeed, status, viewport]);

  useEffect(() => {
    const pending = pendingScrollIndexRef.current;
    if (pending === null || pending >= cards.length) {
      return;
    }
    pendingScrollIndexRef.current = null;
    const frame = requestAnimationFrame(() => {
      scrollToIndex(Math.min(pending, cards.length - 1));
    });
    return () => cancelAnimationFrame(frame);
  }, [cards.length, scrollToIndex]);

  useEffect(() => {
    api<{ cards: SavedCard[] }>('/api/v1/me/saved?limit=50')
      .then((data) => {
        setSavedIds(new Set(data.cards.map((card) => card.id)));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    api<CardDetail>(`/api/v1/cards/${active.id}`)
      .then((data) => {
        if (!cancelled && data.card.saved) {
          setSavedIds((current) => new Set(current).add(active.id));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    setAnnouncement(
      t('cardAnnouncement', {
        current: activeIndex + 1,
        total: cards.length,
        hook: active.hook,
      }),
    );
  }, [active, activeIndex, cards.length, t]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const cardId = active.id;
    const started = Date.now();
    return () => {
      void enqueue(cardId, 'VIEW', Date.now() - started).catch(() => undefined);
    };
  }, [active, enqueue]);

  const saveCard = useCallback(
    async (card: FeedCard) => {
      if (savedIds.has(card.id)) {
        return;
      }
      try {
        const result = await enqueue(card.id, 'SAVE');
        setSavedIds((current) => new Set(current).add(card.id));
        toast(result === 'queued' ? t('queuedToast') : t('savedToast'), 'success');
      } catch {
        toast(t('errorGeneric'), 'error');
      }
    },
    [enqueue, savedIds, t, toast],
  );

  const advanceFrom = useCallback(
    (cardId: string) => {
      const currentIndex = cards.findIndex((card) => card.id === cardId);
      if (currentIndex < 0) {
        return;
      }
      if (currentIndex < cards.length - 1) {
        scrollToIndex(currentIndex + 1);
        return;
      }
      if (cursorRef.current) {
        pendingScrollIndexRef.current = currentIndex + 1;
        void loadFeed(activeMode, false);
      }
    },
    [activeMode, cards, loadFeed, scrollToIndex],
  );

  const rateCard = useCallback(
    (card: FeedCard, interactionType: 'LIKE' | 'DISLIKE', message: string) => {
      advanceFrom(card.id);
      void enqueue(card.id, interactionType)
        .then(() => toast(message, 'success'))
        .catch(() => toast(t('errorGeneric'), 'error'));
    },
    [advanceFrom, enqueue, t, toast],
  );

  const scheduleCard = useCallback(
    async (card: FeedCard, intervalDays: 1 | 3 | 7 | 14) => {
      if (reviewBusyId) {
        return;
      }
      if (!online) {
        toast(t('reviewNeedsOnline'), 'error');
        return;
      }
      setReviewBusyId(card.id);
      try {
        await api(`/api/v1/cards/${card.id}/review`, {
          method: 'POST',
          body: { interval_days: intervalDays },
          headers: { 'idempotency-key': newIdempotencyKey('review') },
        });
        toast(t('reviewRecorded'), 'success');
        if (activeMode === 'review') {
          const currentIndex = cards.findIndex((item) => item.id === card.id);
          heightsRef.current.delete(card.id);
          setCards((current) => current.filter((item) => item.id !== card.id));
          if (currentIndex >= 0) {
            pendingScrollIndexRef.current = currentIndex;
          }
        }
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 429) {
          toast(t('errorRateLimited'), 'error');
        } else {
          toast(t('errorGeneric'), 'error');
        }
      } finally {
        setReviewBusyId(null);
      }
    },
    [activeMode, cards, online, reviewBusyId, t, toast],
  );

  const recordSourceClick = useCallback(
    (card: FeedCard) => {
      void enqueue(card.id, 'CLICK_SOURCE').catch(() => undefined);
    },
    [enqueue],
  );

  const saveActive = useCallback(() => {
    if (active) {
      void saveCard(active);
    }
  }, [active, saveCard]);

  const goNext = useCallback(() => {
    if (activeIndex < cards.length - 1) {
      scrollToIndex(activeIndex + 1);
      return;
    }
    if (cursorRef.current) {
      pendingScrollIndexRef.current = activeIndex + 1;
      void loadFeed(activeMode, false);
    }
  }, [activeIndex, activeMode, cards.length, loadFeed, scrollToIndex]);

  const goPrevious = useCallback(() => {
    if (activeIndex > 0) {
      scrollToIndex(activeIndex - 1);
    }
  }, [activeIndex, scrollToIndex]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('input, textarea, select, [contenteditable="true"]') ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        goPrevious();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveActive();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrevious, saveActive]);

  const isReview = activeMode === 'review';

  return (
    <div className="flex flex-col">
      {children}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {status === 'loading' && (
        <div className="w-full">
          <FeedSkeleton />
        </div>
      )}

      {status === 'error' && cards.length === 0 && (
        <div className="surface-panel w-full flex min-h-[26rem] flex-col items-center justify-center rounded-[1.8rem] p-8 text-center">
          <p className="font-display text-2xl font-semibold">{t('feedLoadError')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{error}</p>
          <button
            type="button"
            onClick={() => void loadFeed(activeMode, true)}
            className="btn btn-primary mt-5"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {status !== 'loading' && status !== 'error' && cards.length === 0 && (
        <div className="surface-panel w-full flex min-h-[26rem] flex-col items-center justify-center rounded-[1.8rem] p-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
            <SparkIcon className="h-7 w-7" />
          </span>
          <h2 className="mt-5 font-display text-3xl font-semibold">
            {isReview ? t('reviewEmptyTitle') : t('feedEmptyTitle')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {isReview ? t('reviewEmptyBody') : t('feedEmptyBody')}
          </p>
          <Link href={isReview ? '/feed' : '/sources'} className="btn btn-primary mt-6">
            {isReview ? t('reviewStart') : t('browseSources')}
          </Link>
        </div>
      )}

      {cards.length > 0 && (
        <div
          ref={listRef}
          className="w-full"
          style={{ overflowAnchor: 'none' }}
        >
          {topSpacer > 0 && <div style={{ height: topSpacer }} aria-hidden />}
          {cards.slice(range.start, range.end).map((card, offset) => {
            const index = range.start + offset;
            return (
              <FeedCardSlot
                key={card.id}
                card={card}
                active={index === activeIndex}
                saved={savedIds.has(card.id)}
                reviewBusy={reviewBusyId === card.id}
                onMeasure={measureCard}
                onSave={() => void saveCard(card)}
                onLike={() => rateCard(card, 'LIKE', t('likedToast'))}
                onDislike={() => rateCard(card, 'DISLIKE', t('dislikedToast'))}
                onSchedule={(intervalDays) => void scheduleCard(card, intervalDays)}
                onSourceClick={() => recordSourceClick(card)}
              />
            );
          })}
          {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} aria-hidden />}
        </div>
      )}

      {status === 'loadingMore' && cards.length > 0 && (
        <div className="w-full mt-1 flex justify-center">
          <span className="rounded-full border border-line bg-elevated/90 px-3 py-1 text-[0.68rem] font-semibold text-muted">
            {t('loading')}
          </span>
        </div>
      )}

      {status === 'error' && cards.length > 0 && (
        <div className="w-full mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadFeed(activeMode, false)}
            className="btn btn-secondary"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {ended && cards.length > 0 && (
        <div className="surface-panel w-full mt-2 flex flex-col items-center rounded-[1.8rem] p-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-success/15 text-success">
            <SparkIcon className="h-7 w-7" />
          </span>
          <h2 className="mt-5 font-display text-3xl font-semibold">
            {isReview ? t('reviewEmptyTitle') : t('endTitle')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            {isReview ? t('reviewEmptyBody') : t('endBody')}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {isReview ? (
              <Link href="/feed" className="btn btn-primary">
                {t('reviewStart')}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void loadFeed(activeMode, true)}
                className="btn btn-primary"
              >
                {t('refreshFeed')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}