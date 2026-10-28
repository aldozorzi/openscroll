import { describe, expect, it } from 'vitest';
import type { FeedItem } from '@openscroll/ingest';
import {
  articleInsertFromFeedItem,
  computeContentHash,
  isArticlePending,
  isSourceDue,
  nextFetchAt,
  retentionCutoffs,
  scopeArticleUrlHash,
  truncateError,
} from './transform';

const now = new Date('2026-10-22T12:00:00.000Z');

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    externalId: 'item-1',
    url: 'https://Example.com/article?utm_source=feed&b=2&a=1#section',
    title: '  Test article  ',
    publishedAt: '2026-10-20T08:00:00.000Z',
    author: 'Author',
    contentHtml: '<p>Hello</p>',
    contentText: 'Hello',
    summary: null,
    ...overrides,
  };
}

describe('articleInsertFromFeedItem', () => {
  it('canonicalizes the URL and sets a retention deadline', () => {
    const row = articleInsertFromFeedItem(feedItem(), 'source-1', now, 30);

    expect(row).toEqual({
      sourceId: 'source-1',
      title: 'Test article',
      originalUrl: 'https://example.com/article?a=1&b=2',
      canonicalUrl: 'https://example.com/article?a=1&b=2',
      urlHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      publishedAt: new Date('2026-10-20T08:00:00.000Z'),
      status: 'pending',
      retentionExpiresAt: new Date('2026-11-21T12:00:00.000Z'),
    });
  });

  it('returns null for an unsupported URL', () => {
    expect(
      articleInsertFromFeedItem(
        feedItem({ url: 'javascript:alert(1)' }),
        'source-1',
        now,
        30,
      ),
    ).toBeNull();
  });

  it('falls back to a safe title and null publication date', () => {
    const row = articleInsertFromFeedItem(
      feedItem({ title: '   ', publishedAt: 'not-a-date' }),
      'source-1',
      now,
      7,
    );

    expect(row?.title).toBe('Untitled');
    expect(row?.publishedAt).toBeNull();
  });
});

describe('worker helpers', () => {
  it('computes a stable SHA-256 content hash', () => {
    expect(computeContentHash('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(computeContentHash('hello')).toBe(computeContentHash('hello'));
  });

  it('scopes private article hashes per owner and keeps public hashes global', () => {
    const hash = 'a'.repeat(64);
    expect(scopeArticleUrlHash(hash, { isPublic: true, ownerId: 'owner-a' })).toBe(hash);
    expect(scopeArticleUrlHash(hash, { isPublic: false, ownerId: null })).toBe(hash);

    const first = scopeArticleUrlHash(hash, { isPublic: false, ownerId: 'owner-a' });
    const second = scopeArticleUrlHash(hash, { isPublic: false, ownerId: 'owner-b' });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(hash);
    expect(first).not.toBe(second);
    expect(scopeArticleUrlHash(hash, { isPublic: false, ownerId: 'owner-a' })).toBe(first);
  });

  it('computes safe fetch intervals', () => {
    expect(nextFetchAt(now, 60).toISOString()).toBe(
      '2026-10-22T13:00:00.000Z',
    );
    expect(nextFetchAt(now, 0).toISOString()).toBe(
      '2026-10-22T12:01:00.000Z',
    );
  });

  it('computes retention cutoffs in days', () => {
    const cutoffs = retentionCutoffs(now, 7, 30);
    expect(cutoffs.rawContentBefore.toISOString()).toBe(
      '2026-10-15T12:00:00.000Z',
    );
    expect(cutoffs.cleanedContentBefore.toISOString()).toBe(
      '2026-09-22T12:00:00.000Z',
    );
  });

  it('truncates long errors', () => {
    expect(truncateError(new Error('abcdef'), 4)).toBe('abcd...');
    expect(truncateError('short')).toBe('short');
  });

  it('detects due sources and pending articles', () => {
    expect(
      isSourceDue({ isActive: true, nextFetchAt: null }, now),
    ).toBe(true);
    expect(
      isSourceDue({ isActive: true, nextFetchAt: now }, now),
    ).toBe(true);
    expect(
      isSourceDue(
        { isActive: true, nextFetchAt: new Date(now.getTime() + 1) },
        now,
      ),
    ).toBe(false);
    expect(
      isSourceDue({ isActive: false, nextFetchAt: null }, now),
    ).toBe(false);

    expect(isArticlePending('pending')).toBe(true);
    expect(isArticlePending('failed')).toBe(true);
    expect(isArticlePending('processing')).toBe(true);
    expect(isArticlePending('ready')).toBe(false);
    expect(isArticlePending('skipped')).toBe(false);
  });
});
