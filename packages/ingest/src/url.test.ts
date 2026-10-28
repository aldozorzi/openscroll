import { describe, expect, it } from 'vitest';
import {
  canonicalizeAndHash,
  canonicalizeUrl,
  hashUrl,
  InvalidUrlError,
  isProbablyUrl,
  MAX_URL_LENGTH,
  resolveUrl,
} from './url';

describe('canonicalizeUrl', () => {
  it('lowercases the host, removes default ports and tracking parameters', () => {
    expect(
      canonicalizeUrl(
        'HTTPS://Example.COM:443/Post?utm_source=x&b=2&a=1&fbclid=abc#section',
      ),
    ).toBe('https://example.com/Post?a=1&b=2');
  });

  it('resolves relative URLs against a base', () => {
    expect(resolveUrl('/feed.xml', 'https://example.com/blog/')).toBe(
      'https://example.com/feed.xml',
    );
  });

  it('rejects non-http protocols and embedded credentials', () => {
    expect(() => canonicalizeUrl('ftp://example.com/file')).toThrow(
      InvalidUrlError,
    );
    expect(() => canonicalizeUrl('https://user:pass@example.com/')).toThrow(
      InvalidUrlError,
    );
  });

  it('rejects URLs above the maximum length', () => {
    const longUrl = `https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`;
    expect(() => canonicalizeUrl(longUrl)).toThrow(InvalidUrlError);
  });

  it('produces deterministic hashes', () => {
    const a = canonicalizeAndHash('https://example.com/a?utm_medium=x');
    const b = canonicalizeAndHash('https://EXAMPLE.com/a');
    expect(a).toEqual(b);
    expect(hashUrl(a.url)).toHaveLength(64);
  });

  it('detects absolute http URLs', () => {
    expect(isProbablyUrl('https://example.com')).toBe(true);
    expect(isProbablyUrl('/relative')).toBe(false);
  });
});
