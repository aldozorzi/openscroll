import { cosineSimilarity } from '@openscroll/ai';
import { seededUnit } from './hash';
import type { FeedCandidate, RankedCandidate, RankingWeights } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_FRESHNESS_HALF_LIFE_DAYS = 14;
export const DEFAULT_DUE_HORIZON_DAYS = 7;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function semanticScore(
  userVector: number[] | null,
  embedding: number[] | null,
): number {
  if (!userVector || !embedding || userVector.length !== embedding.length) {
    return 0.5;
  }

  return clamp01((cosineSimilarity(userVector, embedding) + 1) / 2);
}

export function fsrsDueScore(
  nextReview: Date | null | undefined,
  now: Date,
  horizonDays = DEFAULT_DUE_HORIZON_DAYS,
): number {
  if (!nextReview || horizonDays <= 0) {
    return 0;
  }

  const overdueDays = (now.getTime() - nextReview.getTime()) / DAY_MS;
  if (!Number.isFinite(overdueDays) || overdueDays <= 0) {
    return 0;
  }

  return clamp01(overdueDays / horizonDays);
}

export function freshnessScore(
  publishedAt: Date | null,
  createdAt: Date,
  now: Date,
  halfLifeDays = DEFAULT_FRESHNESS_HALF_LIFE_DAYS,
): number {
  if (halfLifeDays <= 0) {
    return 1;
  }

  const reference = publishedAt ?? createdAt;
  const ageDays = Math.max(0, (now.getTime() - reference.getTime()) / DAY_MS);
  if (!Number.isFinite(ageDays)) {
    return 0;
  }

  return clamp01(0.5 ** (ageDays / halfLifeDays));
}

export function candidateScore(
  candidate: FeedCandidate,
  options: {
    weights: RankingWeights;
    userVector: number[] | null;
    now: Date;
    seed: string;
    halfLifeDays?: number;
    dueHorizonDays?: number;
    penalty?: number;
  },
): number {
  const semantic = semanticScore(options.userVector, candidate.embedding);
  const fsrs = candidate.review
    ? fsrsDueScore(candidate.review.nextReview, options.now, options.dueHorizonDays)
    : 0;
  const fresh = freshnessScore(
    candidate.publishedAt,
    candidate.createdAt,
    options.now,
    options.halfLifeDays,
  );
  const explore = seededUnit(options.seed, candidate.id);
  const penalty = clamp01(options.penalty ?? candidate.penalty ?? 0);

  return clamp01(
    options.weights.semantic * semantic +
      options.weights.fsrs * fsrs +
      options.weights.fresh * fresh +
      options.weights.explore * explore -
      penalty,
  );
}

export function scoreCandidates(
  candidates: readonly FeedCandidate[],
  options: {
    weights: RankingWeights;
    userVector: number[] | null;
    now: Date;
    seed: string;
    halfLifeDays?: number;
    dueHorizonDays?: number;
    penaltyByCardId?: ReadonlyMap<string, number>;
  },
): RankedCandidate[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: candidateScore(candidate, {
        ...options,
        penalty: options.penaltyByCardId?.get(candidate.id),
      }),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.candidate.id === right.candidate.id) {
        return 0;
      }
      return left.candidate.id < right.candidate.id ? -1 : 1;
    });
}
