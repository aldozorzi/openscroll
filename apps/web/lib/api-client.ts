import type { ApiErrorBody } from '@openscroll/contracts';
import { CSRF_COOKIE, CSRF_HEADER } from './csrf';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(
    status: number,
    body: Partial<ApiErrorBody> | null,
    fallback = 'Request failed',
  ) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'INTERNAL_ERROR';
    this.details = body?.error?.details;
    this.requestId = body?.error?.requestId ?? null;
  }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeoutMs?: number;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function api<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 20_000,
  );

  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.body !== undefined && !isFormData) {
    headers.set('content-type', 'application/json');
  }
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) {
      headers.set(CSRF_HEADER, csrf);
    }
  }

  const { body, timeoutMs: _timeoutMs, ...init } = options;

  try {
    const response = await fetch(path, {
      ...init,
      method,
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : { body: isFormData ? (body as FormData) : JSON.stringify(body) }),
    });

    if (!response.ok) {
      let body: Partial<ApiErrorBody> | null = null;
      try {
        body = (await response.json()) as Partial<ApiErrorBody>;
      } catch {
        body = null;
      }
      throw new ApiError(response.status, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (isNetworkError(error)) {
    return fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
