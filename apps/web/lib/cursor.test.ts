import { describe, expect, it } from 'vitest';
import { decodeTimeCursor, encodeTimeCursor } from './cursor';

describe('saved-card cursors', () => {
  it('round-trips a timestamp and id', () => {
    const cursor = {
      createdAt: '2026-10-22T12:34:56.789Z',
      id: '4f2a3b56-1f4d-4f68-9f0d-1ef1f1f1f1f1',
    };
    expect(decodeTimeCursor(encodeTimeCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed cursors', () => {
    expect(() => decodeTimeCursor('not-a-cursor')).toThrow();
    expect(() =>
      decodeTimeCursor(
        Buffer.from(JSON.stringify({ createdAt: 'never', id: 'x' })).toString(
          'base64url',
        ),
      ),
    ).toThrow();
  });
});
