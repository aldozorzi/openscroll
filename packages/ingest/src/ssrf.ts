import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent, fetch as undiciFetch } from 'undici';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>;

export type FetchLike = (
  input: string,
  init: Record<string, unknown>,
) => Promise<Response>;

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedContentTypes?: string[];
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  resolveHost?: ResolveHost;
}

export interface SafeFetchResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  body: Buffer;
  contentType: string;
  text(): string;
  json<T = unknown>(): T;
}

export class SafeFetchError extends Error {
  readonly code: string;

  constructor(message: string, code = 'SAFE_FETCH_ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

export class SsrfError extends SafeFetchError {
  constructor(message: string) {
    super(message, 'SSRF_BLOCKED');
    this.name = 'SsrfError';
  }
}

const defaultResolveHost: ResolveHost = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({
    address: result.address,
    family: result.family === 6 ? 6 : 4,
  }));
};

export function isPublicIp(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6') {
      const ipv6 = parsed as ipaddr.IPv6;
      if (ipv6.isIPv4MappedAddress()) {
        parsed = ipv6.toIPv4Address();
      }
    }
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}

export function assertPublicIp(address: string): void {
  if (!isPublicIp(address)) {
    throw new SsrfError(`Blocked non-public address: ${address}`);
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

export function parseHttpUrl(input: string, base?: string): URL {
  let url: URL;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    throw new SafeFetchError('URL is not valid', 'INVALID_URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError('Only http and https URLs are allowed');
  }
  if (url.username || url.password) {
    throw new SsrfError('URLs with embedded credentials are not allowed');
  }
  if (!url.hostname) {
    throw new SsrfError('URL must include a hostname');
  }

  return url;
}

export async function assertPublicHttpUrl(
  input: string,
  resolveHost: ResolveHost = defaultResolveHost,
  base?: string,
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  const url = parseHttpUrl(input, base);
  const hostname = normalizeHostname(url.hostname);

  const addresses = await resolveHost(hostname);
  if (addresses.length === 0) {
    throw new SsrfError(`Could not resolve host: ${hostname}`);
  }

  for (const address of addresses) {
    assertPublicIp(address.address);
  }

  return { url, addresses };
}

function pinnedLookup(addresses: ResolvedAddress[]): unknown {
  return (
    _hostname: string,
    options: unknown,
    callback: (...args: unknown[]) => void,
  ) => {
    const opts = (options ?? {}) as { all?: boolean };
    if (opts.all) {
      callback(
        null,
        addresses.map((address) => ({
          address: address.address,
          family: address.family,
        })),
      );
      return;
    }
    callback(null, addresses[0]?.address, addresses[0]?.family);
  };
}

function responseResult(
  url: string,
  response: Response,
  body: Buffer,
): SafeFetchResponse {
  return {
    url,
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    body,
    contentType: response.headers.get('content-type') ?? '',
    text: () => body.toString('utf8'),
    json: <T>() => JSON.parse(body.toString('utf8')) as T,
  };
}

async function readBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError(
        `Response exceeds the ${maxBytes} byte limit`,
        'MAX_BYTES',
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

function assertAllowedContentType(
  headers: Headers,
  allowedContentTypes: string[] | undefined,
): void {
  if (!allowedContentTypes || allowedContentTypes.length === 0) {
    return;
  }

  const contentType = (headers.get('content-type') ?? '').toLowerCase();
  const allowed = allowedContentTypes.some((type) =>
    contentType.includes(type.toLowerCase()),
  );
  if (!allowed) {
    throw new SafeFetchError(
      `Unexpected content type: ${contentType || 'unknown'}`,
      'CONTENT_TYPE',
    );
  }
}

export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const {
    method = 'GET',
    headers = {},
    timeoutMs = 10_000,
    maxBytes = 5 * 1024 * 1024,
    maxRedirects = 3,
    allowedContentTypes,
    signal,
    fetchImpl = undiciFetch as unknown as FetchLike,
    resolveHost = defaultResolveHost,
  } = options;

  let current = input instanceof URL ? input : parseHttpUrl(input);
  let redirects = 0;

  while (true) {
    const { url, addresses } = await assertPublicHttpUrl(
      current.toString(),
      resolveHost,
    );

    const dispatcher =
      fetchImpl === (undiciFetch as unknown as FetchLike)
        ? new Agent({
            connect: {
              lookup: pinnedLookup(addresses) as never,
            },
          })
        : undefined;

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        redirect: 'manual',
        signal: requestSignal,
        ...(dispatcher ? { dispatcher } : {}),
      });
    } catch (error) {
      if (dispatcher) {
        await dispatcher.close();
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SafeFetchError('Request timed out', 'TIMEOUT', {
          cause: error,
        });
      }
      throw new SafeFetchError('Request failed', 'NETWORK', { cause: error });
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (dispatcher) {
        await dispatcher.close();
      }
      if (!location) {
        throw new SafeFetchError(
          'Redirect response did not include a Location header',
          'REDIRECT',
        );
      }
      if (redirects >= maxRedirects) {
        throw new SafeFetchError('Too many redirects', 'REDIRECT');
      }

      redirects += 1;
      current = parseHttpUrl(location, url.toString());
      continue;
    }

    if (response.status === 304) {
      await response.body?.cancel();
      if (dispatcher) {
        await dispatcher.close();
      }
      return responseResult(url.toString(), response, Buffer.alloc(0));
    }

    try {
      try {
        assertAllowedContentType(response.headers, allowedContentTypes);
      } catch (error) {
        await response.body?.cancel();
        throw error;
      }
      const contentLength = Number(
        response.headers.get('content-length') ?? '0',
      );
      if (contentLength > maxBytes) {
        await response.body?.cancel();
        throw new SafeFetchError(
          `Response declares ${contentLength} bytes, above the ${maxBytes} byte limit`,
          'MAX_BYTES',
        );
      }

      const body = await readBody(response, maxBytes);
      return responseResult(url.toString(), response, body);
    } finally {
      if (dispatcher) {
        await dispatcher.close();
      }
    }
  }
}

export function createSafeFetch(
  defaults: SafeFetchOptions,
): (input: string | URL, options?: SafeFetchOptions) => Promise<SafeFetchResponse> {
  return (input, options) =>
    safeFetch(input, {
      ...defaults,
      ...options,
    });
}
