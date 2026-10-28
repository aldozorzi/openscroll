import { describe, expect, it } from 'vitest';
import { applyCursor, decodeCursor, encodeCursor } from './cursor';
import type { RankedCandidate } from './types';

function entry(id: string, score: number): RankedCandidate {
  return {
    score,
    candidate: {
      id,
      articleId: `a-${id}`,
      hook: 'Hook',
      coreConcept: 'Concept',
      keyTakeaways: [],
      topicTags: [],
      language: 'en',
      estimatedReadTimeSec: 60,
      sourceId: 's1',
      sourceTitle: 'Source',
      sourceUrl: 'https://source.example',
      originalUrl: null,
      publishedAt: null,
      createdAt: new Date('2026-10-22T12:00:00.000Z'),
      embedding: [1, 0],
      status: 'published',
      review: null,
    },
  };
}

describe('cursor', () => {
  it('round-trips a valid cursor', () => {
    const encoded = encodeCursor({
      score: 0.75,
      id: 'card-1',
      seed: 'seed-1',
      mode: 'learn',
    });

    expect(decodeCursor(encoded)).toEqual({
      v: 1,
      score: 0.75,
      id: 'card-1',
      seed: 'seed-1',
      mode: 'learn',
    });
  });

  it('rejects malformed and oversized cursors', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrowError(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    );
    expect(() => decodeCursor('x'.repeat(2049))).toThrowError(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    );
  });

  it('rejects cursors with invalid fields', () => {
    const invalid = Buffer.from(
      JSON.stringify({ v: 1, score: 2, id: 'card', seed: 'seed', mode: 'mixed' }),
    ).toString('base64url');

    expect(() => decodeCursor(invalid)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CURSOR' }),
    );
  });

  it('keeps only entries strictly after the cursor', () => {
    const result = applyCursor(
      [entry('a', 0.9), entry('b', 0.8), entry('c', 0.8), entry('d', 0.7)],
      {
        v: 1,
        score: 0.8,
        id: 'b',
        seed: 'seed',
        mode: 'mixed',
      },
    );

    expect(result.map((item) => item.candidate.id)).toEqual(['c', 'd']);
  });
});
