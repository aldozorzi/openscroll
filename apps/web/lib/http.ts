import { randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { ZodError, type z } from 'zod';
import { getServerEnv } from '@openscroll/config';
import { apiError, type ApiErrorCode } from '@openscroll/contracts';

export { SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER } from './csrf';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from './csrf';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

export interface RequestMeta {
  requestId: string;
  ip: string | null;
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    const key = part.slice(0, separator).trim();
    if (key !== name) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function getClientIp(request: Request): string | null {
  // Forwarded headers are fully client-controlled unless a trusted reverse
  // proxy overwrites them. Never use them for rate limiting by default,
  // otherwise an attacker can rotate fake IPs to bypass every IP bucket.
  if (!getServerEnv().TRUST_PROXY) {
    return null;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const candidate =
    forwarded?.split(',')[0]?.trim() ??
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    null;

  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

export function requestMeta(request: Request): RequestMeta {
  const supplied = request.headers.get('x-request-id');
  return {
    requestId:
      supplied && /^[a-zA-Z0-9_.:-]{1,128}$/.test(supplied)
        ? supplied
        : `req_${randomUUID()}`,
    ip: getClientIp(request),
  };
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store', ...headers },
  });
}

export function errorResponse(
  error: HttpError,
  requestId: string,
): Response {
  return json(
    apiError(error.code, error.message, error.details, requestId),
    error.status,
    { 'x-request-id': requestId, ...error.headers },
  );
}

export function withRequestId(response: Response, requestId: string): Response {
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return response;
}

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return 'unknown';
  }
}

function logRequest(
  level: 'info' | 'error',
  event: string,
  request: Request,
  meta: RequestMeta,
  status: number,
  startedAt: number,
  error?: unknown,
): void {
  const line = JSON.stringify({
    level,
    event,
    requestId: meta.requestId,
    method: request.method,
    path: requestPath(request),
    status,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    ...(error
      ? { message: error instanceof Error ? error.message : 'Unknown error' }
      : {}),
  });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export async function handleRoute(
  request: Request,
  handler: (meta: RequestMeta) => Promise<Response>,
): Promise<Response> {
  const meta = requestMeta(request);
  const startedAt = performance.now();

  try {
    const response = withRequestId(await handler(meta), meta.requestId);
    logRequest('info', 'request_completed', request, meta, response.status, startedAt);
    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      const response = withRequestId(
        errorResponse(error, meta.requestId),
        meta.requestId,
      );
      logRequest(
        error.status >= 500 ? 'error' : 'info',
        'request_completed',
        request,
        meta,
        error.status,
        startedAt,
        error.status >= 500 ? error : undefined,
      );
      return response;
    }
    if (error instanceof ZodError) {
      const response = withRequestId(
        errorResponse(
          new HttpError(400, 'BAD_REQUEST', 'Invalid request', {
            details: error.issues,
          }),
          meta.requestId,
        ),
        meta.requestId,
      );
      logRequest('info', 'request_completed', request, meta, 400, startedAt);
      return response;
    }

    logRequest(
      'error',
      'request_failed',
      request,
      meta,
      500,
      startedAt,
      error,
    );
    return withRequestId(
      errorResponse(
        new HttpError(500, 'INTERNAL_ERROR', 'Internal server error'),
        meta.requestId,
      ),
      meta.requestId,
    );
  }
}

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

function declaredBodyTooLarge(request: Request, maxBytes: number): boolean {
  const header = request.headers.get('content-length');
  if (!header) {
    return false;
  }
  const declared = Number(header);
  return Number.isFinite(declared) && declared > maxBytes;
}

export async function readBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!request.body) {
    return new Uint8Array(0);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'BAD_REQUEST', 'Request body is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readTextBody(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<string> {
  if (declaredBodyTooLarge(request, maxBytes)) {
    throw new HttpError(413, 'BAD_REQUEST', 'Request body is too large');
  }
  const bytes = await readBodyBytes(request, maxBytes);
  return new TextDecoder().decode(bytes);
}

export async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = await readTextBody(request);
  if (raw.trim() === '') {
    throw new HttpError(400, 'BAD_REQUEST', 'Request body must be valid JSON');
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Request body must be valid JSON');
  }
  return schema.parse(body);
}

export async function parseOptionalJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = await readTextBody(request);
  if (raw.trim() === '') {
    return schema.parse({});
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'Request body must be valid JSON');
  }
  return schema.parse(body);
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) {
    return;
  }

  const requestUrl = new URL(request.url);
  const allowed = new Set<string>([requestUrl.origin]);
  const trustProxy = getServerEnv().TRUST_PROXY;

  // Forwarded headers are client-controlled unless a trusted proxy rewrites
  // them. Only use them to widen the allowed-origin set when explicitly
  // configured, otherwise a spoofed X-Forwarded-Host widens the CSRF boundary.
  const forwardedHost = trustProxy
    ? request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    : undefined;
  const host = forwardedHost ?? request.headers.get('host');
  const forwardedProto = trustProxy
    ? request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    : undefined;
  const protocol = forwardedProto ?? requestUrl.protocol.replace(':', '');
  if (host) {
    try {
      allowed.add(new URL(`${protocol}://${host}`).origin);
    } catch {
      // Ignore a malformed host header; other allowed origins still apply.
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      // Ignore a malformed app URL; the request origin still applies.
    }
  }

  if (!allowed.has(origin)) {
    throw new HttpError(403, 'FORBIDDEN', 'Origin is not allowed');
  }
}

export function assertCsrf(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  const cookie = getCookie(request, CSRF_COOKIE);
  const header = request.headers.get(CSRF_HEADER);
  if (!cookie || !header) {
    throw new HttpError(403, 'FORBIDDEN', 'Missing CSRF token');
  }

  const left = Buffer.from(cookie);
  const right = Buffer.from(header);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new HttpError(403, 'FORBIDDEN', 'Invalid CSRF token');
  }
}

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

export function appendCookie(
  response: Response,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    `SameSite=${options.sameSite ?? 'Lax'}`,
  ];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly ?? true) {
    parts.push('HttpOnly');
  }
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  response.headers.append('set-cookie', parts.join('; '));
}

export function secureCompare(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
