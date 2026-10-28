import type { FeedMode } from '@openscroll/contracts';
import type { FeedCandidate } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_LEARN_COOLDOWN_DAYS = 7;

export interface FeedFilterOptions {
  now: Date;
  mode: FeedMode;
  userVector: number[] | null;
  dismissedCardIds?: ReadonlySet<string>;
  seenCardIds?: ReadonlySet<string>;
  excludedTopics?: readonly string[];
  language?: string | null;
  learnCooldownDays?: number;
}

function hasValidEmbedding(candidate: FeedCandidate, userVector: number[] | null): boolean {
  if (!candidate.embedding || candidate.embedding.length === 0) {
    return false;
  }
  if (userVector && candidate.embedding.length !== userVector.length) {
    return false;
  }
  return candidate.embedding.every((value) => Number.isFinite(value));
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLocaleLowerCase();
}

function isReviewedRecently(
  candidate: FeedCandidate,
  now: Date,
  cooldownDays: number,
): boolean {
  if (!candidate.review?.lastReview) {
    return false;
  }

  return now.getTime() - candidate.review.lastReview.getTime() < cooldownDays * DAY_MS;
}

export function filterCandidates(
  candidates: readonly FeedCandidate[],
  options: FeedFilterOptions,
): FeedCandidate[] {
  const dismissed = options.dismissedCardIds;
  const seen = options.seenCardIds;
  const excludedTopics = new Set(
    (options.excludedTopics ?? []).map((topic) => normalizeTopic(topic)),
  );
  const language = options.language?.trim().toLocaleLowerCase() ?? null;
  const cooldownDays = options.learnCooldownDays ?? DEFAULT_LEARN_COOLDOWN_DAYS;

  return candidates.filter((candidate) => {
    if (candidate.status !== 'published') {
      return false;
    }
    if (!hasValidEmbedding(candidate, options.userVector)) {
      return false;
    }
    if (dismissed?.has(candidate.id) || seen?.has(candidate.id)) {
      return false;
    }
    if (language && candidate.language?.toLocaleLowerCase() !== language) {
      return false;
    }
    if (
      excludedTopics.size > 0 &&
      candidate.topicTags.some((topic) => excludedTopics.has(normalizeTopic(topic)))
    ) {
      return false;
    }

    if (options.mode === 'review') {
      return (
        candidate.review !== null &&
        candidate.review.nextReview.getTime() <= options.now.getTime()
      );
    }

    if (
      options.mode === 'learn' &&
      isReviewedRecently(candidate, options.now, cooldownDays)
    ) {
      return false;
    }

    return true;
  });
}
