import { describe, expect, it } from 'vitest';
import {
  applyInteraction,
  applyInteractions,
  coldStartVector,
  interactionAlpha,
  meanVector,
} from './user-vector';

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

describe('interactionAlpha', () => {
  it('uses positive weights for likes and saves', () => {
    expect(interactionAlpha('LIKE', 0)).toBe(0.05);
    expect(interactionAlpha('SAVE', 0)).toBe(0.05);
  });

  it('uses a negative weight for dismissals', () => {
    expect(interactionAlpha('DISMISS', 0)).toBe(-0.03);
  });

  it('uses dwell time for views', () => {
    expect(interactionAlpha('VIEW', 10_001)).toBe(0.05);
    expect(interactionAlpha('VIEW', 1_999)).toBe(-0.03);
    expect(interactionAlpha('VIEW', 5_000)).toBe(0);
  });

  it('keeps source clicks neutral', () => {
    expect(interactionAlpha('CLICK_SOURCE', 30_000)).toBe(0);
  });

  it('rejects invalid dwell times', () => {
    expect(() => interactionAlpha('VIEW', -1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DWELL_TIME' }),
    );
  });
});

describe('applyInteraction', () => {
  it('bootstraps a normalized vector from the first positive interaction', () => {
    const vector = applyInteraction(null, [3, 4], 0.05);
    expect(vector).toEqual([0.6, 0.8]);
    expect(norm(vector ?? [])).toBeCloseTo(1);
  });

  it('ignores the first negative interaction', () => {
    expect(applyInteraction(null, [1, 0], -0.03)).toBeNull();
  });

  it('moves and renormalizes an existing vector', () => {
    const vector = applyInteraction([1, 0], [0, 1], 0.05);
    expect(vector).not.toBeNull();
    expect(vector?.[0]).toBeGreaterThan(0);
    expect(vector?.[1]).toBeGreaterThan(0);
    expect(norm(vector ?? [])).toBeCloseTo(1);
  });

  it('returns the original vector for a zero alpha', () => {
    const original = [1, 0];
    expect(applyInteraction(original, [0, 1], 0)).toBe(original);
  });

  it('validates alpha and dimensions', () => {
    expect(() => applyInteraction([1, 0], [1, 0], 2)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ALPHA' }),
    );
    expect(() => applyInteraction([1, 0], [1, 0, 0], 0.05)).toThrowError(
      expect.objectContaining({ code: 'VECTOR_DIMENSION_MISMATCH' }),
    );
  });
});

describe('vector aggregation', () => {
  it('applies interactions in order', () => {
    const vector = applyInteractions(null, [
      { embedding: [1, 0], type: 'LIKE', dwellTimeMs: 0 },
      { embedding: [0, 1], type: 'VIEW', dwellTimeMs: 20_000 },
    ]);

    expect(vector).not.toBeNull();
    expect(vector?.[0]).toBeGreaterThan(0);
    expect(vector?.[1]).toBeGreaterThan(0);
    expect(norm(vector ?? [])).toBeCloseTo(1);
  });

  it('averages and normalizes embeddings', () => {
    expect(meanVector([[2, 0], [4, 0]])).toEqual([1, 0]);
    expect(norm(meanVector([[1, 1], [1, 0]]) ?? [])).toBeCloseTo(1);
  });

  it('returns null for an empty cold start', () => {
    expect(coldStartVector([])).toBeNull();
    expect(coldStartVector([[1, 0]])).toEqual([1, 0]);
  });

  it('rejects empty and mismatched averages', () => {
    expect(() => meanVector([])).toThrowError(
      expect.objectContaining({ code: 'EMPTY_VECTORS' }),
    );
    expect(() => meanVector([[1, 0], [1, 0, 0]])).toThrowError(
      expect.objectContaining({ code: 'VECTOR_DIMENSION_MISMATCH' }),
    );
  });
});
