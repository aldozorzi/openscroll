import { describe, expect, it } from 'vitest';
import { FeedQuerySchema, MAX_CURSOR_LENGTH } from './feed';

describe('FeedQuerySchema', () => {
  it('applies defaults and bounds', () => {
    expect(FeedQuerySchema.parse({})).toEqual({ limit: 10, mode: 'mixed' });
    expect(FeedQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(FeedQuerySchema.safeParse({ mode: 'unknown' }).success).toBe(false);
  });

  it('accepts cursors up to the maximum length only', () => {
    expect(
      FeedQuerySchema.safeParse({ cursor: 'a'.repeat(MAX_CURSOR_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      FeedQuerySchema.safeParse({ cursor: 'a'.repeat(MAX_CURSOR_LENGTH + 1) })
        .success,
    ).toBe(false);
  });
});
