import { describe, expect, it } from 'vitest';
import { rankFeed } from './rank';
import type { FeedCandidate } from './types';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_EXPLORE_WEIGHTS = { semantic: 0.55, fsrs: 0.3, fresh: 0.15, explore: 0 };

function candidate(id: string, overrides: Partial<FeedCandidate> = {}): FeedCandidate {
  return {
    id,
    articleId: `a-${id}`,
    hook: `Hook ${id}`,
    coreConcept: `Concept ${id}`,
    keyTakeaways: ['takeaway'],
    topicTags: [`topic-${id}`],
    language: 'en',
    estimatedReadTimeSec: 60,
    sourceId: `source-${id}`,
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

describe('rankFeed', () => {
  it('prioritizes overdue review cards', () => {
    const page = rankFeed(
      [
        candidate('new-card'),
        candidate('due-card', {
          review: {
            nextReview: new Date(NOW.getTime() - 30 * DAY_MS),
            lastReview: new Date(NOW.getTime() - 60 * DAY_MS),
            state: 2,
          },
        }),
      ],
      {
        now: NOW,
        mode: 'mixed',
        limit: 10,
        seed: 'seed',
        userVector: [1, 0],
        weights: NO_EXPLORE_WEIGHTS,
      },
    );

    expect(page.cards.map((card) => card.id)).toEqual(['due-card', 'new-card']);
  });

  it('excludes dismissed and seen cards before ranking', () => {
    const page = rankFeed(
      [candidate('c1'), candidate('c2'), candidate('c3')],
      {
        now: NOW,
        mode: 'mixed',
        limit: 10,
        seed: 'seed',
        userVector: null,
        dismissedCardIds: new Set(['c1']),
        seenCardIds: new Set(['c2']),
      },
    );

    expect(page.cards.map((card) => card.id)).toEqual(['c3']);
  });

  it('caps cards per source', () => {
    const page = rankFeed(
      ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) =>
        candidate(id, { sourceId: 'single-source' }),
      ),
      {
        now: NOW,
        mode: 'mixed',
        limit: 10,
        seed: 'seed',
        userVector: null,
        maxPerSource: 2,
      },
    );

    expect(page.cards).toHaveLength(2);
  });

  it('caps cards per topic', () => {
    const page = rankFeed(
      ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) =>
        candidate(id, { topicTags: ['same-topic'] }),
      ),
      {
        now: NOW,
        mode: 'mixed',
        limit: 10,
        seed: 'seed',
        userVector: null,
        maxPerTopic: 3,
      },
    );

    expect(page.cards).toHaveLength(3);
    expect(page.cards.every((card) => card.topicTags[0] === 'same-topic')).toBe(true);
  });

  it('paginates deterministically with a score and id cursor', () => {
    const candidates = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id, index) =>
      candidate(id, {
        publishedAt: new Date(NOW.getTime() - index * DAY_MS),
      }),
    );
    const baseOptions = {
      now: NOW,
      mode: 'mixed' as const,
      limit: 2,
      seed: 'cursor-seed',
      userVector: [1, 0],
      weights: NO_EXPLORE_WEIGHTS,
    };

    const first = rankFeed(candidates, baseOptions);
    expect(first.cards).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = rankFeed(candidates, {
      ...baseOptions,
      cursor: first.nextCursor,
    });
    expect(second.cards).toHaveLength(2);

    const third = rankFeed(candidates, {
      ...baseOptions,
      cursor: second.nextCursor,
    });
    expect(third.cards).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    const ids = [...first.cards, ...second.cards, ...third.cards].map((card) => card.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('returns a fresh cold-start mix when no user vector exists', () => {
    const page = rankFeed(
      [
        candidate('old', { publishedAt: new Date(NOW.getTime() - 60 * DAY_MS) }),
        candidate('fresh', { publishedAt: NOW }),
      ],
      {
        now: NOW,
        mode: 'mixed',
        limit: 10,
        seed: 'seed',
        userVector: null,
        weights: NO_EXPLORE_WEIGHTS,
      },
    );

    expect(page.cards[0]?.id).toBe('fresh');
  });

  it('rejects cursors from a different feed mode', () => {
    const first = rankFeed([candidate('c1'), candidate('c2')], {
      now: NOW,
      mode: 'mixed',
      limit: 1,
      seed: 'seed',
      userVector: null,
    });

    expect(() =>
      rankFeed([candidate('c1'), candidate('c2')], {
        now: NOW,
        mode: 'learn',
        limit: 1,
        seed: 'seed',
        userVector: null,
        cursor: first.nextCursor,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR' }));
  });

  it('validates limit and seed', () => {
    expect(() =>
      rankFeed([candidate('c1')], {
        now: NOW,
        mode: 'mixed',
        limit: 0,
        seed: 'seed',
        userVector: null,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_LIMIT' }));

    expect(() =>
      rankFeed([candidate('c1')], {
        now: NOW,
        mode: 'mixed',
        limit: 1,
        seed: '',
        userVector: null,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_SEED' }));
  });
});
