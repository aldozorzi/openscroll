import { and, eq } from 'drizzle-orm';
import type { Database } from '@openscroll/db';
import { cardReviews, cards, userCardReviews } from '@openscroll/db';
import {
  DAY_MS,
  DEFAULT_DESIRED_RETENTION,
  isReviewRating,
  rowToMemoryState,
  transitionReview,
} from './scheduler';
import type { FsrsMemoryState, ReviewStateRow } from './types';
import { FsrsError } from './types';
import { Rating } from 'ts-fsrs';

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;
export type ReviewIntervalDays = (typeof REVIEW_INTERVAL_DAYS)[number];

function intervalDaysToRating(days: ReviewIntervalDays): number {
  switch (days) {
    case 1:
      return Rating.Again;
    case 3:
      return Rating.Hard;
    case 7:
      return Rating.Good;
    case 14:
      return Rating.Easy;
  }
}

function isValidIntervalDays(value: number): value is ReviewIntervalDays {
  return REVIEW_INTERVAL_DAYS.includes(value as ReviewIntervalDays);
}

export interface SubmitReviewInput {
  userId: string;
  cardId: string;
  intervalDays: ReviewIntervalDays;
  idempotencyKey: string;
  now?: Date;
  desiredRetention?: number;
}

export interface SubmitReviewResult {
  reviewId: string;
  cardId: string;
  intervalDays: ReviewIntervalDays;
  duplicate: boolean;
  reviewedAt: Date;
  nextReview: Date;
  state: FsrsMemoryState;
}

function stateRowValues(row: typeof userCardReviews.$inferSelect): ReviewStateRow {
  return {
    due: row.nextReview,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.step,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReview: row.lastReview,
  };
}

function validateInput(input: SubmitReviewInput): string {
  if (!input.userId) {
    throw new FsrsError('userId is required', 'INVALID_INPUT');
  }
  if (!input.cardId) {
    throw new FsrsError('cardId is required', 'INVALID_INPUT');
  }
  if (!isValidIntervalDays(input.intervalDays)) {
    throw new FsrsError(`Invalid review interval: ${input.intervalDays}`, 'INVALID_INTERVAL');
  }

  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length === 0 || idempotencyKey.length > 255) {
    throw new FsrsError(
      'idempotencyKey must contain between 1 and 255 characters',
      'INVALID_IDEMPOTENCY_KEY',
    );
  }

  return idempotencyKey;
}

export async function submitReview(
  db: Database,
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> {
  const idempotencyKey = validateInput(input);
  const now = input.now ?? new Date();
  const rating = intervalDaysToRating(input.intervalDays);

  return db.transaction(async (tx) => {
    const [existingReview] = await tx
      .select()
      .from(cardReviews)
      .where(
        and(
          eq(cardReviews.userId, input.userId),
          eq(cardReviews.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);

    if (existingReview) {
      if (existingReview.cardId !== input.cardId) {
        throw new FsrsError(
          'Idempotency key was already used for a different card',
          'IDEMPOTENCY_CONFLICT',
        );
      }

      const [existingState] = await tx
        .select()
        .from(userCardReviews)
        .where(
          and(
            eq(userCardReviews.userId, input.userId),
            eq(userCardReviews.cardId, input.cardId),
          ),
        )
        .limit(1);

      if (!existingState) {
        throw new FsrsError(
          'Card review state is missing for an existing review',
          'STATE_NOT_FOUND',
        );
      }

      return {
        reviewId: existingReview.id,
        cardId: existingReview.cardId,
        intervalDays: existingState.scheduledDays as ReviewIntervalDays,
        duplicate: true,
        reviewedAt: existingReview.reviewedAt,
        nextReview: existingState.nextReview,
        state: rowToMemoryState(stateRowValues(existingState)),
      };
    }

    const [card] = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.id, input.cardId))
      .limit(1);

    if (!card) {
      throw new FsrsError('Card not found', 'CARD_NOT_FOUND');
    }

    const [currentState] = await tx
      .select()
      .from(userCardReviews)
      .where(
        and(
          eq(userCardReviews.userId, input.userId),
          eq(userCardReviews.cardId, input.cardId),
        ),
      )
      .limit(1);

    const desiredRetention =
      input.desiredRetention ??
      currentState?.desiredRetention ??
      DEFAULT_DESIRED_RETENTION;
    const transition = transitionReview(
      currentState ? rowToMemoryState(stateRowValues(currentState)) : null,
      rating,
      now,
      desiredRetention,
    );

    // Override next review and scheduled days to exact interval
    const exactDue = new Date(now.getTime() + input.intervalDays * DAY_MS);
    transition.card.due = exactDue;
    transition.card.scheduledDays = input.intervalDays;
    transition.log.scheduledDays = input.intervalDays;

    const [insertedReview] = await tx
      .insert(cardReviews)
      .values({
        userId: input.userId,
        cardId: input.cardId,
        rating,
        stateBefore: transition.log.stateBefore,
        stateAfter: transition.card.state,
        stabilityBefore: transition.log.stabilityBefore,
        stabilityAfter: transition.card.stability,
        difficultyBefore: transition.log.difficultyBefore,
        difficultyAfter: transition.card.difficulty,
        elapsedDays: transition.log.elapsedDays,
        scheduledDays: transition.log.scheduledDays,
        idempotencyKey,
        reviewedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: cardReviews.id, reviewedAt: cardReviews.reviewedAt });

    if (!insertedReview) {
      const [racedReview] = await tx
        .select()
        .from(cardReviews)
        .where(
          and(
            eq(cardReviews.userId, input.userId),
            eq(cardReviews.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      if (!racedReview) {
        throw new FsrsError('Failed to persist card review', 'REVIEW_NOT_PERSISTED');
      }
      if (racedReview.cardId !== input.cardId) {
        throw new FsrsError(
          'Idempotency key was already used for a different card',
          'IDEMPOTENCY_CONFLICT',
        );
      }

      const [racedState] = await tx
        .select()
        .from(userCardReviews)
        .where(
          and(
            eq(userCardReviews.userId, input.userId),
            eq(userCardReviews.cardId, input.cardId),
          ),
        )
        .limit(1);

      if (!racedState) {
        throw new FsrsError(
          'Card review state is missing for an existing review',
          'STATE_NOT_FOUND',
        );
      }

      return {
        reviewId: racedReview.id,
        cardId: racedReview.cardId,
        intervalDays: racedState.scheduledDays as ReviewIntervalDays,
        duplicate: true,
        reviewedAt: racedReview.reviewedAt,
        nextReview: racedState.nextReview,
        state: rowToMemoryState(stateRowValues(racedState)),
      };
    }

    await tx
      .insert(userCardReviews)
      .values({
        userId: input.userId,
        cardId: input.cardId,
        stability: transition.card.stability,
        difficulty: transition.card.difficulty,
        elapsedDays: transition.card.elapsedDays,
        scheduledDays: transition.card.scheduledDays,
        reps: transition.card.reps,
        lapses: transition.card.lapses,
        state: transition.card.state,
        step: transition.card.learningSteps,
        desiredRetention,
        lastReview: transition.card.lastReview,
        nextReview: transition.card.due,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userCardReviews.userId, userCardReviews.cardId],
        set: {
          stability: transition.card.stability,
          difficulty: transition.card.difficulty,
          elapsedDays: transition.card.elapsedDays,
          scheduledDays: transition.card.scheduledDays,
          reps: transition.card.reps,
          lapses: transition.card.lapses,
          state: transition.card.state,
          step: transition.card.learningSteps,
          desiredRetention,
          lastReview: transition.card.lastReview,
          nextReview: transition.card.due,
          updatedAt: now,
        },
      });

    return {
      reviewId: insertedReview.id,
      cardId: input.cardId,
      intervalDays: input.intervalDays,
      duplicate: false,
      reviewedAt: insertedReview.reviewedAt,
      nextReview: transition.card.due,
      state: transition.card,
    };
  });
}

export async function getReviewState(
  db: Database,
  userId: string,
  cardId: string,
): Promise<FsrsMemoryState | null> {
  const [row] = await db
    .select()
    .from(userCardReviews)
    .where(and(eq(userCardReviews.userId, userId), eq(userCardReviews.cardId, cardId)))
    .limit(1);

  return row ? rowToMemoryState(stateRowValues(row)) : null;
}