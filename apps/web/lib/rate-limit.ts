import { HttpError } from './http';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

const globalForRateLimit = globalThis as typeof globalThis & {
  __openscrollRateLimits?: Map<string, Bucket>;
};

function buckets(): Map<string, Bucket> {
  globalForRateLimit.__openscrollRateLimits ??= new Map();
  return globalForRateLimit.__openscrollRateLimits;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const store = buckets();
  if (store.size > 10_000) {
    for (const [storedKey, bucket] of store) {
      if (bucket.resetAt <= now) {
        store.delete(storedKey);
      }
    }
  }

  const existing = store.get(key);
  const bucket =
    !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;

  bucket.count += 1;
  store.set(key, bucket);

  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): void {
  const result = checkRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many requests', {
      headers: {
        'retry-after': String(result.retryAfterSeconds),
        'x-ratelimit-limit': String(result.limit),
        'x-ratelimit-remaining': '0',
      },
    });
  }
}

export function resetRateLimitsForTests(): void {
  buckets().clear();
}
