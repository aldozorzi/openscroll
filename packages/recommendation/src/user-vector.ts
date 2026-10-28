import type { InteractionType } from '@openscroll/contracts';
import { normalizeVector } from '@openscroll/ai';
import { RecommendationError } from './errors';

export const POSITIVE_INTERACTION_ALPHA = 0.05;
export const NEGATIVE_INTERACTION_ALPHA = -0.03;
export const LONG_DWELL_MS = 10_000;
export const SHORT_DWELL_MS = 2_000;

export function interactionAlpha(type: InteractionType, dwellTimeMs: number): number {
  if (!Number.isFinite(dwellTimeMs) || dwellTimeMs < 0) {
    throw new RecommendationError('dwellTimeMs must be a non-negative number', 'INVALID_DWELL_TIME');
  }

  if (type === 'LIKE' || type === 'SAVE') {
    return POSITIVE_INTERACTION_ALPHA;
  }
  if (type === 'DISMISS') {
    return NEGATIVE_INTERACTION_ALPHA;
  }
  if (type === 'VIEW') {
    if (dwellTimeMs > LONG_DWELL_MS) {
      return POSITIVE_INTERACTION_ALPHA;
    }
    if (dwellTimeMs < SHORT_DWELL_MS) {
      return NEGATIVE_INTERACTION_ALPHA;
    }
  }
  return 0;
}

function assertSameDimensions(left: number[], right: number[]): void {
  if (left.length !== right.length) {
    throw new RecommendationError(
      'User vector and card embedding must have the same dimensions',
      'VECTOR_DIMENSION_MISMATCH',
    );
  }
}

export function applyInteraction(
  userVector: number[] | null,
  cardEmbedding: number[],
  alpha: number,
): number[] | null {
  if (!Number.isFinite(alpha) || alpha < -1 || alpha > 1) {
    throw new RecommendationError('alpha must be between -1 and 1', 'INVALID_ALPHA');
  }
  if (alpha === 0) {
    return userVector;
  }
  if (userVector === null) {
    return alpha > 0 ? normalizeVector(cardEmbedding) : null;
  }

  assertSameDimensions(userVector, cardEmbedding);
  const weight = Math.abs(alpha);
  const next = userVector.map(
    (value, index) => (1 - weight) * value + alpha * (cardEmbedding[index] ?? 0),
  );
  return normalizeVector(next);
}

export interface InteractionEmbedding {
  embedding: number[];
  type: InteractionType;
  dwellTimeMs: number;
}

export function applyInteractions(
  userVector: number[] | null,
  interactions: readonly InteractionEmbedding[],
): number[] | null {
  let vector = userVector;
  for (const interaction of interactions) {
    const alpha = interactionAlpha(interaction.type, interaction.dwellTimeMs);
    vector = applyInteraction(vector, interaction.embedding, alpha);
  }
  return vector;
}

export function meanVector(vectors: readonly number[][]): number[] {
  if (vectors.length === 0) {
    throw new RecommendationError('Cannot average an empty vector list', 'EMPTY_VECTORS');
  }

  const first = vectors[0];
  if (!first) {
    throw new RecommendationError('Cannot average an empty vector list', 'EMPTY_VECTORS');
  }
  for (const vector of vectors) {
    assertSameDimensions(first, vector);
  }

  const mean = first.map(
    (_value, index) =>
      vectors.reduce((sum, vector) => sum + (vector[index] ?? 0), 0) / vectors.length,
  );
  return normalizeVector(mean);
}

export function coldStartVector(vectors: readonly number[][]): number[] | null {
  return vectors.length === 0 ? null : meanVector(vectors);
}
