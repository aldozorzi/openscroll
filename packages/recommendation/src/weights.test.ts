import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, resolveWeights } from './weights';

describe('resolveWeights', () => {
  it('returns the documented defaults', () => {
    expect(resolveWeights()).toEqual({
      semantic: 0.5,
      fsrs: 0.25,
      fresh: 0.15,
      explore: 0.1,
    });
    expect(DEFAULT_WEIGHTS.semantic).toBe(0.5);
  });

  it('accepts complete overrides that sum to one', () => {
    expect(
      resolveWeights({ semantic: 0.4, fsrs: 0.3, fresh: 0.2, explore: 0.1 }),
    ).toEqual({ semantic: 0.4, fsrs: 0.3, fresh: 0.2, explore: 0.1 });
  });

  it('rejects weights that do not sum to one', () => {
    expect(() => resolveWeights({ semantic: 0.4 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_WEIGHTS' }),
    );
  });

  it('rejects negative and non-finite weights', () => {
    expect(() =>
      resolveWeights({ semantic: -0.1, fsrs: 0.5, fresh: 0.4, explore: 0.2 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_WEIGHTS' }));
    expect(() =>
      resolveWeights({ semantic: Number.NaN, fsrs: 0.5, fresh: 0.4, explore: 0.1 }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_WEIGHTS' }));
  });
});
