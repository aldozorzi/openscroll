import { describe, expect, it } from 'vitest';
import { MAX_SOURCE_URL_LENGTH, SourceInputSchema } from './source';

describe('SourceInputSchema', () => {
  it('accepts http and https URLs and trims metadata', () => {
    expect(SourceInputSchema.parse({ url: 'https://example.com/feed' })).toEqual(
      { url: 'https://example.com/feed' },
    );
    expect(
      SourceInputSchema.parse({
        url: 'http://example.com/feed',
        title: '  Example  ',
        category: '  tech  ',
      }),
    ).toEqual({
      url: 'http://example.com/feed',
      title: 'Example',
      category: 'tech',
    });
  });

  it('rejects non-http protocols', () => {
    for (const url of [
      'ftp://example.com/feed',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ]) {
      expect(SourceInputSchema.safeParse({ url }).success).toBe(false);
    }
  });

  it('rejects URLs above the maximum length', () => {
    const longUrl = `https://example.com/${'a'.repeat(MAX_SOURCE_URL_LENGTH)}`;
    expect(SourceInputSchema.safeParse({ url: longUrl }).success).toBe(false);
  });
});
