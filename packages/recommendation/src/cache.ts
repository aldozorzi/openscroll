import type { FeedMode } from '@openscroll/contracts';

export const DEFAULT_FEED_CACHE_TTL_MS = 60_000;

export interface FeedCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  invalidateUser(userId: string): Promise<void>;
  invalidateAll(): Promise<void>;
}

export interface FeedCacheKeyInput {
  userId: string;
  mode: FeedMode;
  cursor?: string | null;
  limit: number;
  seed: string;
  language?: string | null;
}

export function createFeedCacheKey(input: FeedCacheKeyInput): string {
  const fingerprint = JSON.stringify({
    mode: input.mode,
    cursor: input.cursor ?? null,
    limit: input.limit,
    seed: input.seed,
    language: input.language ?? null,
  });
  return `feed:${input.userId}:${encodeURIComponent(fingerprint)}`;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

export interface TtlFeedCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class TtlFeedCache implements FeedCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TtlFeedCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_FEED_CACHE_TTL_MS;
    this.maxEntries = options.maxEntries ?? 500;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    this.purgeExpired();
    return this.entries.size;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs = this.ttlMs): Promise<void> {
    this.purgeExpired();
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + Math.max(0, ttlMs) });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  async invalidateUser(userId: string): Promise<void> {
    const prefix = `feed:${userId}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  async invalidateAll(): Promise<void> {
    this.entries.clear();
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
