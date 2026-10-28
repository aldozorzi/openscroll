export const FSRS_STATES = [0, 1, 2, 3] as const;

export type FsrsState = (typeof FSRS_STATES)[number];

export interface FsrsMemoryState {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: FsrsState;
  lastReview: Date | null;
}

export interface FsrsReviewLogValues {
  stateBefore: FsrsState;
  stabilityBefore: number;
  difficultyBefore: number;
  elapsedDays: number;
  scheduledDays: number;
  reviewedAt: Date;
}

export interface ReviewTransition {
  card: FsrsMemoryState;
  log: FsrsReviewLogValues;
}

export interface ReviewStateRow {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
}

export class FsrsError extends Error {
  readonly code: string;

  constructor(message: string, code = 'FSRS_ERROR') {
    super(message);
    this.name = 'FsrsError';
    this.code = code;
  }
}
