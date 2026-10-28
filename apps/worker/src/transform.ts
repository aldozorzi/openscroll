import { createHash } from 'node:crypto';
import { canonicalizeAndHash, type FeedItem } from '@openscroll/ingest';

const DAY_MS = 86_400_000;

export interface ArticleInsertRow {
  sourceId: string;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  urlHash: string;
  publishedAt: Date | null;
  status: 'pending';
  retentionExpiresAt: Date;
}

export function articleInsertFromFeedItem(
  item: FeedItem,
  sourceId: string,
  now: Date,
  retentionDays: number,
): ArticleInsertRow | null {
  let canonical: { url: string; hash: string };
  try {
    canonical = canonicalizeAndHash(item.url);
  } catch {
    return null;
  }

  const title = item.title.trim().slice(0, 512) || 'Untitled';
  return {
    sourceId,
    title,
    originalUrl: canonical.url,
    canonicalUrl: canonical.url,
    urlHash: canonical.hash,
    publishedAt: parsePublishedAt(item.publishedAt),
    status: 'pending',
    retentionExpiresAt: addDays(now, retentionDays),
  };
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Private feeds are per-user. Two users subscribing to the same private URL
 * must not share article rows: a shared row would be attributed to one source
 * and therefore visible to only one of them. Scope the dedupe hash by owner so
 * each user gets an independent copy while retries and repeated ingestion stay
 * idempotent for that owner. Public feeds keep the global canonical hash.
 */
export function scopeArticleUrlHash(
  urlHash: string,
  source: { isPublic: boolean; ownerId: string | null },
): string {
  if (source.isPublic || !source.ownerId) {
    return urlHash;
  }
  return createHash('sha256')
    .update(`private:${source.ownerId}:${urlHash}`)
    .digest('hex');
}

function parsePublishedAt(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function computeContentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function nextFetchAt(now: Date, intervalMinutes: number): Date {
  const minutes = Math.max(1, intervalMinutes);
  return new Date(now.getTime() + minutes * 60_000);
}

export function retentionCutoffs(
  now: Date,
  rawContentRetentionDays: number,
  cleanedContentRetentionDays: number,
): { rawContentBefore: Date; cleanedContentBefore: Date } {
  return {
    rawContentBefore: addDays(now, -rawContentRetentionDays),
    cleanedContentBefore: addDays(now, -cleanedContentRetentionDays),
  };
}

export function truncateError(error: unknown, maxLength = 1_000): string {
  const message =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return message.length > maxLength ? `${message.slice(0, maxLength)}...` : message;
}

export function isSourceDue(
  source: { isActive: boolean; nextFetchAt: Date | null },
  now: Date,
): boolean {
  return (
    source.isActive &&
    (source.nextFetchAt === null || source.nextFetchAt.getTime() <= now.getTime())
  );
}

export function isArticlePending(status: string): boolean {
  return status === 'pending' || status === 'failed' || status === 'processing';
}
