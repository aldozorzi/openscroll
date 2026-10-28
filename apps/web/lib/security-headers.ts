export interface SecurityHeaderOptions {
  nonce?: string;
  isDevelopment?: boolean;
  isHttps?: boolean;
}

const BASE_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-dns-prefetch-control': 'off',
};

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export function contentSecurityPolicy(options: SecurityHeaderOptions = {}): string {
  const development = options.isDevelopment ?? false;
  const scriptSources = [
    "'self'",
    ...(options.nonce ? [`'nonce-${options.nonce}'`, "'strict-dynamic'"] : []),
    ...(development ? ["'unsafe-eval'", "'unsafe-inline'"] : []),
    TURNSTILE_ORIGIN,
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${TURNSTILE_ORIGIN}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(options.isHttps && !development ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function securityHeaders(
  options: SecurityHeaderOptions = {},
): Record<string, string> {
  return {
    ...BASE_HEADERS,
    'content-security-policy': contentSecurityPolicy(options),
    ...(options.isHttps
      ? {
          'strict-transport-security':
            'max-age=63072000; includeSubDomains; preload',
        }
      : {}),
  };
}

export function applySecurityHeaders(
  headers: Headers,
  options: SecurityHeaderOptions = {},
): void {
  for (const [name, value] of Object.entries(securityHeaders(options))) {
    headers.set(name, value);
  }
}
