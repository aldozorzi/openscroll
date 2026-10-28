import { describe, expect, it } from 'vitest';
import { cosineSimilarity, normalizeVector } from './vector';

describe('vector helpers', () => {
  it('normalizes vectors to unit length', () => {
    const vector = normalizeVector([3, 4]);
    expect(vector[0]).toBeCloseTo(0.6);
    expect(vector[1]).toBeCloseTo(0.8);
  });

  it('rejects zero vectors', () => {
    expect(() => normalizeVector([0, 0])).toThrow(/zero vector/);
  });

  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});
