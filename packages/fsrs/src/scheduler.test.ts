import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import {
  dueUrgency,
  isDue,
  reviewedWithinDays,
  rowToMemoryState,
  transitionReview,
} from './scheduler';
import { FsrsError, type FsrsMemoryState } from './types';

const NOW = new Date('2026-10-22T12:00:00.000Z');

function minutesFromNow(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

describe('transitionReview', () => {
  it('creates a new learning card from an empty state', () => {
    const result = transitionReview(null, Rating.Good, NOW);

    expect(result.log.stateBefore).toBe(0);
    expect(result.log.stabilityBefore).toBe(0);
    expect(result.log.difficultyBefore).toBe(0);
    expect(result.card.state).toBe(1);
    expect(result.card.reps).toBe(1);
    expect(result.card.lastReview).toEqual(NOW);
    expect(result.card.due.getTime()).toBeGreaterThan(NOW.getTime());
    expect(result.card.stability).toBeGreaterThan(0);
  });

  it('keeps the previous state in the log and the next state on the card', () => {
    const first = transitionReview(null, Rating.Good, NOW);
    const second = transitionReview(first.card, Rating.Good, minutesFromNow(10));

    expect(second.log.stateBefore).toBe(first.card.state);
    expect(second.log.stabilityBefore).toBe(first.card.stability);
    expect(second.log.difficultyBefore).toBe(first.card.difficulty);
    expect(second.card.state).not.toBe(second.log.stateBefore);
    expect(second.card.reps).toBe(first.card.reps + 1);
    expect(second.log.scheduledDays).toBe(second.card.scheduledDays);
  });

  it('schedules an Easy review on a later calendar day', () => {
    const result = transitionReview(null, Rating.Easy, NOW);
    const dueDays = (result.card.due.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);

    expect(result.card.state).toBe(2);
    expect(dueDays).toBeGreaterThanOrEqual(1);
    expect(result.log.scheduledDays).toBeGreaterThanOrEqual(1);
  });

  it('supports relearning after an Again rating on a mature card', () => {
    const easy = transitionReview(null, Rating.Easy, NOW);
    const again = transitionReview(easy.card, Rating.Again, minutesFromNow(60 * 24 * 10));

    expect(easy.card.state).toBe(2);
    expect(again.card.state).toBe(3);
    expect(again.card.lapses).toBe(easy.card.lapses + 1);
  });

  it('is deterministic when fuzz is disabled', () => {
    const first = transitionReview(null, Rating.Good, NOW);
    const second = transitionReview(null, Rating.Good, NOW);

    expect(second).toEqual(first);
  });

  it('rejects invalid ratings, retention, and timestamps', () => {
    expect(() => transitionReview(null, 0, NOW)).toThrowError(
      expect.objectContaining({ code: 'INVALID_RATING' }),
    );
    expect(() => transitionReview(null, Rating.Good, NOW, 0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_RETENTION' }),
    );
    expect(() => transitionReview(null, Rating.Good, new Date('invalid'))).toThrowError(
      expect.objectContaining({ code: 'INVALID_REVIEW_TIME' }),
    );
  });
});

describe('dueUrgency', () => {
  it('returns zero for missing or future reviews', () => {
    expect(dueUrgency(null, NOW)).toBe(0);
    expect(dueUrgency(minutesFromNow(60), NOW)).toBe(0);
  });

  it('scales overdue days against the horizon', () => {
    const overdue = new Date(NOW.getTime() - 3.5 * 24 * 60 * 60 * 1000);
    expect(dueUrgency(overdue, NOW, 7)).toBeCloseTo(0.5);
  });

  it('caps urgency at one', () => {
    const overdue = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(dueUrgency(overdue, NOW, 7)).toBe(1);
  });

  it('handles non-positive horizons', () => {
    const overdue = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(dueUrgency(overdue, NOW, 0)).toBe(0);
  });
});

describe('review helpers', () => {
  it('detects due cards at the boundary', () => {
    expect(isDue(NOW, NOW)).toBe(true);
    expect(isDue(minutesFromNow(1), NOW)).toBe(false);
    expect(isDue(null, NOW)).toBe(false);
  });

  it('detects recent reviews within a cooldown window', () => {
    expect(reviewedWithinDays(minutesFromNow(-60), NOW, 1)).toBe(true);
    expect(reviewedWithinDays(minutesFromNow(-60 * 25), NOW, 1)).toBe(false);
    expect(reviewedWithinDays(null, NOW, 1)).toBe(false);
  });

  it('maps persisted rows to memory state', () => {
    const state: FsrsMemoryState = {
      due: NOW,
      stability: 2,
      difficulty: 3,
      elapsedDays: 4,
      scheduledDays: 5,
      learningSteps: 6,
      reps: 7,
      lapses: 8,
      state: 2,
      lastReview: NOW,
    };

    expect(rowToMemoryState(state)).toEqual(state);
    expect(() => rowToMemoryState({ ...state, state: 9 })).toThrowError(FsrsError);
  });
});
