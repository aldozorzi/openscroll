import { describe, expect, it } from 'vitest';
import {
  candidateScore,
  clamp01,
  freshnessScore,
  fsrsDueScore,
  scoreCandidates,
  semanticScore,
} from './scoring';
import type { FeedCandidate } from './types';
import { resolveWeights } from './weights';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function candidate(overrides: Partial<FeedCandidate> = {}): FeedCandidate {
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

describe('semanticScore', () => {
  it('maps cosine similarity into zero to one', () => {
    expect(semanticScore([1, 0], [1, 0])).toBe(1);
    expect(semanticScore([1, 0], [0, 1])).toBe(0.5);
    expect(semanticScore([1, 0], [-1, 0])).toBe(0);
  });

  it('uses a neutral value without a user vector', () => {
    expect(semanticScore(null, [1, 0])).toBe(0.5);
    expect(semanticScore([1, 0], null)).toBe(0.5);
    expect(semanticScore([1, 0], [1, 0, 0])).toBe(0.5);
  });
});

describe('fsrsDueScore', () => {
  it('returns zero for new and future cards', () => {
    expect(fsrsDueScore(null, NOW)).toBe(0);
    expect(fsrsDueScore(new Date(NOW.getTime() + DAY_MS), NOW)).toBe(0);
  });

  it('scales and caps overdue days', () => {
    expect(fsrsDueScore(new Date(NOW.getTime() - 3.5 * DAY_MS), NOW)).toBeCloseTo(0.5);
    expect(fsrsDueScore(new Date(NOW.getTime() - 30 * DAY_MS), NOW)).toBe(1);
  });
});

describe('freshnessScore', () => {
  it('halves after one half-life', () => {
    const published = new Date(NOW.getTime() - 14 * DAY_MS);
    expect(freshnessScore(published, NOW, NOW, 14)).toBeCloseTo(0.5);
  });

  it('treats future content as fresh', () => {
    expect(freshnessScore(new Date(NOW.getTime() + DAY_MS), NOW, NOW)).toBe(1);
  });

  it('falls back to creation time when publication is unknown', () => {
    const created = new Date(NOW.getTime() - 28 * DAY_MS);
    expect(freshnessScore(null, created, NOW, 14)).toBeCloseTo(0.25);
  });
});

describe('candidateScore', () => {
  it('is bounded and deterministic', () => {
    const weights = resolveWeights();
    const input = {
      weights,
      userVector: [1, 0],
      now: NOW,
      seed: 'feed-seed',
    };

    const first = candidateScore(candidate(), input);
    const second = candidateScore(candidate(), input);

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1);
  });

  it('subtracts penalties without going below zero', () => {
    const weights = resolveWeights();
    const input = {
      weights,
      userVector: [1, 0],
      now: NOW,
      seed: 'feed-seed',
      penalty: 1,
    };

    expect(candidateScore(candidate(), input)).toBe(0);
  });

  it('sorts by descending score and then by id', () => {
    const weights = resolveWeights();
    const ranked = scoreCandidates(
      [
        candidate({ id: 'b', embedding: [1, 0] }),
        candidate({ id: 'a', embedding: [1, 0] }),
      ],
      {
        weights: { semantic: 0.55, fsrs: 0.3, fresh: 0.15, explore: 0 },
        userVector: [1, 0],
        now: NOW,
        seed: 'seed',
      },
    );

    expect(ranked.map((entry) => entry.candidate.id)).toEqual(['a', 'b']);
  });

  it('clamps arbitrary values', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });
});
