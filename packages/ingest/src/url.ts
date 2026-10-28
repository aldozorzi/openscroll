import { createHash } from 'node:crypto';

const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
]);

/** Upper bound for any URL accepted from users or feeds. */
export const MAX_URL_LENGTH = 2_048;

export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

export function canonicalizeUrl(input: string, base?: string): string {
  if (input.length > MAX_URL_LENGTH) {
    throw new InvalidUrlError(
      `URL exceeds the ${MAX_URL_LENGTH} character limit`,
    );
  }

  let url: URL;
  try {
    url = base ? new URL(input, base) : new URL(input);
  } catch {
    throw new InvalidUrlError('URL is not valid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidUrlError('Only http and https URLs are supported');
  }

  if (url.username || url.password) {
    throw new InvalidUrlError('URLs must not contain credentials');
  }

  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAMETERS.has(lower)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();

  const canonical = url.toString();
  if (canonical.length > MAX_URL_LENGTH) {
    throw new InvalidUrlError(
      `URL exceeds the ${MAX_URL_LENGTH} character limit`,
    );
  }
  return canonical;
}

export function resolveUrl(input: string, base: string): string {
  return canonicalizeUrl(input, base);
}

export function hashUrl(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex');
}

export function canonicalizeAndHash(
  input: string,
  base?: string,
): { url: string; hash: string } {
  const url = canonicalizeUrl(input, base);
  return { url, hash: hashUrl(url) };
}

export function isProbablyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
