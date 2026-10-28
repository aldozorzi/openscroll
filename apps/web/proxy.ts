import { NextResponse, type NextRequest } from 'next/server';
import { securityHeaders } from './lib/security-headers';

const STATIC_PREFIXES = [
  '/_next/static',
  '/_next/image',
  '/favicon.ico',
  '/icon.svg',
  '/apple-icon.png',
];

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isHttps(request: NextRequest): boolean {
  const forwarded = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  return forwarded === 'https' || request.nextUrl.protocol === 'https:';
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (STATIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const nonce = createNonce();
  const headers = securityHeaders({
    nonce,
    isDevelopment: process.env.NODE_ENV !== 'production',
    isHttps: isHttps(request),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', headers['content-security-policy'] ?? '');

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value);
  }
  response.headers.set('x-request-id', request.headers.get('x-request-id') ?? crypto.randomUUID());
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
