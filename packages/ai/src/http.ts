import {
  ProviderHttpError,
  ProviderRateLimitError,
  ProviderResponseError,
} from './errors';
import type { FetchLike } from './types';

export interface PostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}

export interface JsonResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function retryDelay(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * baseDelayMs;
  return Math.min(30_000, exponential + jitter);
}

export async function postJson<T>(
  url: string,
  body: unknown,
  options: PostJsonOptions = {},
): Promise<JsonResponse<T>> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);
  const maxRetries = options.maxRetries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 30_000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...options.headers,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await sleep(retryDelay(attempt, baseDelayMs));
        continue;
      }
      throw new ProviderHttpError('Provider request failed', 0, {
        retryable: true,
        cause: error,
      });
    }

    const text = await response.text();

    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(
        response.headers.get('retry-after'),
      );
      if (response.status === 429) {
        lastError = new ProviderRateLimitError(
          'Provider rate limit reached',
          retryAfterMs,
        );
      } else {
        lastError = new ProviderHttpError(
          `Provider returned HTTP ${response.status}`,
          response.status,
          {
            retryable: response.status >= 500,
            retryAfterMs,
          },
        );
      }

      if (attempt < maxRetries && response.status !== 401 && response.status !== 403) {
        await sleep(retryAfterMs ?? retryDelay(attempt, baseDelayMs));
        continue;
      }

      throw lastError;
    }

    if (!text.trim()) {
      return { data: {} as T, status: response.status, headers: response.headers };
    }

    try {
      return {
        data: JSON.parse(text) as T,
        status: response.status,
        headers: response.headers,
      };
    } catch (error) {
      throw new ProviderResponseError('Provider returned invalid JSON', {
        cause: error,
      });
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ProviderHttpError('Provider request failed', 0);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
