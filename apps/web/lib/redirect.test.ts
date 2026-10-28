import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirect';

describe('safeRedirectPath', () => {
  it('keeps same-origin absolute paths', () => {
    expect(safeRedirectPath('/settings')).toBe('/settings');
    expect(safeRedirectPath('/feed?mode=learn')).toBe('/feed?mode=learn');
  });

  it('rejects cross-origin and malformed targets', () => {
    for (const value of [
      undefined,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      '/feed\nSet-Cookie: x=1',
    ]) {
      expect(safeRedirectPath(value)).toBe('/feed');
    }
  });
});
