import { cosineSimilarity } from '@openscroll/ai';
import { RecommendationError } from './errors';
import type { RankedCandidate } from './types';

const UNKNOWN_SOURCE = '__unknown__';

function normalizeTopic(topic: string): string {
  return topic.trim().toLocaleLowerCase();
}

function assertPositiveCap(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RecommendationError(
      `${name} must be a positive integer`,
      'INVALID_DIVERSITY_CAP',
    );
  }
}

export function applyDiversity(
  ranked: readonly RankedCandidate[],
  options: { maxPerSource?: number; maxPerTopic?: number } = {},
): RankedCandidate[] {
  const maxPerSource = options.maxPerSource ?? 2;
  const maxPerTopic = options.maxPerTopic ?? 3;
  assertPositiveCap(maxPerSource, 'maxPerSource');
  assertPositiveCap(maxPerTopic, 'maxPerTopic');

  const sourceCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const selected: RankedCandidate[] = [];

  for (const entry of ranked) {
    const sourceKey = entry.candidate.sourceId ?? UNKNOWN_SOURCE;
    if ((sourceCounts.get(sourceKey) ?? 0) >= maxPerSource) {
      continue;
    }

    const topics = [...new Set(entry.candidate.topicTags.map(normalizeTopic))];
    if (topics.some((topic) => (topicCounts.get(topic) ?? 0) >= maxPerTopic)) {
      continue;
    }

    selected.push(entry);
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);
    for (const topic of topics) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
  }

  return selected;
}

function isBetterMmrCandidate(
  left: { entry: RankedCandidate; value: number },
  right: { entry: RankedCandidate; value: number },
): boolean {
  if (left.value !== right.value) {
    return left.value > right.value;
  }
  return left.entry.candidate.id < right.entry.candidate.id;
}

export function applyMmr(
  ranked: readonly RankedCandidate[],
  lambda: number,
): RankedCandidate[] {
  if (!Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
    throw new RecommendationError('MMR lambda must be between 0 and 1', 'INVALID_MMR_LAMBDA');
  }
  if (ranked.length <= 1) {
    return [...ranked];
  }

  const first = ranked[0];
  if (!first) {
    return [];
  }

  const selected: RankedCandidate[] = [first];
  const remaining = ranked.slice(1);

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      if (!entry) {
        continue;
      }

      let maxSimilarity = -1;
      for (const chosen of selected) {
        if (!entry.candidate.embedding || !chosen.candidate.embedding) {
          continue;
        }
        maxSimilarity = Math.max(
          maxSimilarity,
          cosineSimilarity(entry.candidate.embedding, chosen.candidate.embedding),
        );
      }

      const value = lambda * entry.score - (1 - lambda) * maxSimilarity;
      if (bestValue === Number.NEGATIVE_INFINITY || isBetterMmrCandidate(
        { entry, value },
        { entry: remaining[bestIndex] as RankedCandidate, value: bestValue },
      )) {
        bestValue = value;
        bestIndex = index;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    if (next) {
      selected.push(next);
    }
  }

  return selected;
}
