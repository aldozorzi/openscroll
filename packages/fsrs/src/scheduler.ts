import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';
import type {
  FsrsMemoryState,
  FsrsReviewLogValues,
  FsrsState,
  ReviewStateRow,
  ReviewTransition,
} from './types';
import { FsrsError } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_DESIRED_RETENTION = 0.9;
export const DEFAULT_DUE_HORIZON_DAYS = 7;

const RATINGS = new Set<number>([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
const VALID_STATES = new Set<number>([
  State.New,
  State.Learning,
  State.Review,
  State.Relearning,
]);

export function isReviewRating(value: number): value is Grade {
  return RATINGS.has(value);
}

export function rowToMemoryState(row: ReviewStateRow): FsrsMemoryState {
  if (!VALID_STATES.has(row.state)) {
    throw new FsrsError(`Invalid persisted FSRS state: ${row.state}`, 'INVALID_STATE');
  }

  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as FsrsState,
    lastReview: row.lastReview,
  };
}

function toTsFsrsCard(card: FsrsMemoryState): Card {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview ?? undefined,
  };
}

function fromTsFsrsCard(card: Card): FsrsMemoryState {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as FsrsState,
    lastReview: card.last_review ?? null,
  };
}

export function transitionReview(
  current: FsrsMemoryState | null,
  rating: number,
  now: Date,
  desiredRetention = DEFAULT_DESIRED_RETENTION,
): ReviewTransition {
  if (!isReviewRating(rating)) {
    throw new FsrsError(`Invalid review rating: ${rating}`, 'INVALID_RATING');
  }
  if (!Number.isFinite(desiredRetention) || desiredRetention <= 0 || desiredRetention > 1) {
    throw new FsrsError(
      `Desired retention must be in (0, 1]: ${desiredRetention}`,
      'INVALID_RETENTION',
    );
  }
  if (Number.isNaN(now.getTime())) {
    throw new FsrsError('Review time is invalid', 'INVALID_REVIEW_TIME');
  }

  const scheduler = fsrs({
    request_retention: desiredRetention,
    enable_fuzz: false,
  });
  const before = current ? toTsFsrsCard(current) : createEmptyCard(now);
  const record = scheduler.next(before, now, rating);

  const log: FsrsReviewLogValues = {
    stateBefore: record.log.state as FsrsState,
    stabilityBefore: record.log.stability,
    difficultyBefore: record.log.difficulty,
    elapsedDays: record.log.elapsed_days,
    scheduledDays: record.card.scheduled_days,
    reviewedAt: now,
  };

  return {
    card: fromTsFsrsCard(record.card),
    log,
  };
}

export function dueUrgency(
  nextReview: Date | null | undefined,
  now: Date,
  horizonDays = DEFAULT_DUE_HORIZON_DAYS,
): number {
  if (!nextReview || horizonDays <= 0) {
    return 0;
  }

  const overdueDays = (now.getTime() - nextReview.getTime()) / DAY_MS;
  if (overdueDays <= 0) {
    return 0;
  }

  return Math.min(1, overdueDays / horizonDays);
}

export function isDue(nextReview: Date | null | undefined, now: Date): boolean {
  return nextReview !== null && nextReview !== undefined && nextReview.getTime() <= now.getTime();
}

export function reviewedWithinDays(
  lastReview: Date | null | undefined,
  now: Date,
  days: number,
): boolean {
  if (!lastReview || days < 0) {
    return false;
  }

  return now.getTime() - lastReview.getTime() < days * DAY_MS;
}
