import { RecommendationError } from './errors';
import type { RankingWeights } from './types';

export const DEFAULT_WEIGHTS: Readonly<RankingWeights> = {
  semantic: 0.5,
  fsrs: 0.25,
  fresh: 0.15,
  explore: 0.1,
};

const WEIGHT_KEYS = ['semantic', 'fsrs', 'fresh', 'explore'] as const;
const SUM_EPSILON = 1e-6;

export function resolveWeights(overrides: Partial<RankingWeights> = {}): RankingWeights {
  const weights: RankingWeights = { ...DEFAULT_WEIGHTS, ...overrides };

  for (const key of WEIGHT_KEYS) {
    const value = weights[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new RecommendationError(
        `Ranking weight "${key}" must be a finite non-negative number`,
        'INVALID_WEIGHTS',
      );
    }
  }

  const total = weights.semantic + weights.fsrs + weights.fresh + weights.explore;
  if (Math.abs(total - 1) > SUM_EPSILON) {
    throw new RecommendationError(
      `Ranking weights must sum to 1.0, received ${total}`,
      'INVALID_WEIGHTS',
    );
  }

  return weights;
}
