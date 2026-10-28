import { describe, expect, it } from 'vitest';
import { createFeedCacheKey, TtlFeedCache } from './cache';

describe('createFeedCacheKey', () => {
  it('changes when the page identity changes', () => {
    const base = {
      userId: 'user-1',
      mode: 'mixed' as const,
      limit: 10,
      seed: 'seed',
    };

    const first = createFeedCacheKey(base);
    expect(createFeedCacheKey({ ...base, limit: 5 })).not.toBe(first);
    expect(createFeedCacheKey({ ...base, cursor: 'cursor' })).not.toBe(first);
    expect(createFeedCacheKey({ ...base, language: 'it' })).not.toBe(first);
  });
});

describe('TtlFeedCache', () => {
  it('returns values until the TTL expires', async () => {
    let now = 1_000;
    const cache = new TtlFeedCache({ ttlMs: 60_000, now: () => now });
    await cache.set('key', { cards: [] });

    expect(await cache.get('key')).toEqual({ cards: [] });
    now += 59_999;
    expect(await cache.get('key')).toEqual({ cards: [] });
    now += 1;
    expect(await cache.get('key')).toBeNull();
  });

  it('invalidates all pages for one user only', async () => {
    const cache = new TtlFeedCache();
    await cache.set(createFeedCacheKey({ userId: 'u1', mode: 'mixed', limit: 10, seed: 's' }), 1);
    await cache.set(createFeedCacheKey({ userId: 'u2', mode: 'mixed', limit: 10, seed: 's' }), 2);

    await cache.invalidateUser('u1');

    expect(
      await cache.get(createFeedCacheKey({ userId: 'u1', mode: 'mixed', limit: 10, seed: 's' })),
    ).toBeNull();
    expect(
      await cache.get(createFeedCacheKey({ userId: 'u2', mode: 'mixed', limit: 10, seed: 's' })),
    ).toBe(2);
  });

  it('supports global invalidation', async () => {
    const cache = new TtlFeedCache();
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.invalidateAll();

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBeNull();
  });

  it('evicts the oldest entry when full', async () => {
    const cache = new TtlFeedCache({ maxEntries: 2 });
    await cache.set('a', 1);
    await cache.set('b', 2);
    await cache.set('c', 3);

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBe(2);
    expect(await cache.get('c')).toBe(3);
  });

  it('reports the live entry count', async () => {
    let now = 0;
    const cache = new TtlFeedCache({ ttlMs: 10, now: () => now });
    await cache.set('a', 1);
    expect(cache.size).toBe(1);
    now = 10;
    expect(cache.size).toBe(0);
  });
});
