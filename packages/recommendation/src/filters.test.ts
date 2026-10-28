import { describe, expect, it } from 'vitest';
import { filterCandidates } from './filters';
import type { FeedCandidate } from './types';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

export function candidate(overrides: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    id: 'c1',
    articleId: 'a1',
    hook: 'Hook',
    coreConcept: 'Concept',
    keyTakeaways: ['takeaway'],
    topicTags: ['technology'],
    language: 'en',
    estimatedReadTimeSec: 60,
    sourceId: 's1',
    sourceTitle: 'Source',
    sourceUrl: 'https://source.example',
    originalUrl: 'https://article.example',
    publishedAt: NOW,
    createdAt: NOW,
    embedding: [1, 0],
    status: 'published',
    review: null,
    ...overrides,
  };
}

function filter(candidates: FeedCandidate[], overrides: Partial<Parameters<typeof filterCandidates>[1]> = {}) {
  return filterCandidates(candidates, {
    now: NOW,
    mode: 'mixed',
    userVector: null,
    ...overrides,
  });
}

describe('filterCandidates', () => {
  it('keeps only published cards with valid embeddings', () => {
    const kept = filter([
      candidate({ id: 'ok' }),
      candidate({ id: 'hidden', status: 'hidden' }),
      candidate({ id: 'flagged', status: 'flagged' }),
      candidate({ id: 'missing', embedding: null }),
      candidate({ id: 'empty', embedding: [] }),
      candidate({ id: 'bad', embedding: [1, Number.NaN] }),
      candidate({ id: 'dimensions', embedding: [1, 0, 0] }),
    ], { userVector: [1, 0] });

    expect(kept.map((entry) => entry.id)).toEqual(['ok']);
  });

  it('excludes dismissed and session-seen cards', () => {
    const kept = filter(
      [
        candidate({ id: 'c1' }),
        candidate({ id: 'c2' }),
        candidate({ id: 'c3' }),
      ],
      {
        dismissedCardIds: new Set(['c1']),
        seenCardIds: new Set(['c2']),
      },
    );

    expect(kept.map((entry) => entry.id)).toEqual(['c3']);
  });

  it('excludes excluded topics case-insensitively', () => {
    const kept = filter(
      [
        candidate({ id: 'crypto', topicTags: ['Crypto', 'finance'] }),
        candidate({ id: 'ai', topicTags: ['AI'] }),
      ],
      { excludedTopics: ['crypto'] },
    );

    expect(kept.map((entry) => entry.id)).toEqual(['ai']);
  });

  it('respects the language preference', () => {
    const kept = filter(
      [
        candidate({ id: 'en', language: 'en' }),
        candidate({ id: 'it', language: 'it' }),
        candidate({ id: 'unknown', language: null }),
      ],
      { language: 'IT' },
    );

    expect(kept.map((entry) => entry.id)).toEqual(['it']);
  });

  it('includes only due reviewed cards in review mode', () => {
    const kept = filter(
      [
        candidate({ id: 'new' }),
        candidate({
          id: 'due',
          review: { nextReview: new Date(NOW.getTime() - DAY_MS), lastReview: NOW, state: 2 },
        }),
        candidate({
          id: 'future',
          review: { nextReview: new Date(NOW.getTime() + DAY_MS), lastReview: NOW, state: 2 },
        }),
      ],
      { mode: 'review' },
    );

    expect(kept.map((entry) => entry.id)).toEqual(['due']);
  });

  it('excludes recently reviewed cards in learn mode', () => {
    const kept = filter(
      [
        candidate({ id: 'new' }),
        candidate({
          id: 'recent',
          review: {
            nextReview: new Date(NOW.getTime() - DAY_MS),
            lastReview: new Date(NOW.getTime() - 2 * DAY_MS),
            state: 2,
          },
        }),
        candidate({
          id: 'old',
          review: {
            nextReview: new Date(NOW.getTime() - DAY_MS),
            lastReview: new Date(NOW.getTime() - 30 * DAY_MS),
            state: 2,
          },
        }),
      ],
      { mode: 'learn', learnCooldownDays: 7 },
    );

    expect(kept.map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('keeps all valid cards in mixed mode', () => {
    const kept = filter([
      candidate({ id: 'new' }),
      candidate({
        id: 'reviewed',
        review: { nextReview: NOW, lastReview: NOW, state: 2 },
      }),
    ]);

    expect(kept).toHaveLength(2);
  });
});
