import { describe, expect, it } from 'vitest';
import { applyDiversity, applyMmr } from './diversity';
import type { RankedCandidate } from './types';

function ranked(
  id: string,
  score: number,
  embedding: number[],
  overrides: { sourceId?: string | null; topicTags?: string[] } = {},
): RankedCandidate {
  return {
    score,
    candidate: {
      id,
      articleId: `a-${id}`,
      hook: 'Hook',
      coreConcept: 'Concept',
      keyTakeaways: ['takeaway'],
      topicTags: overrides.topicTags ?? [`topic-${id}`],
      language: 'en',
      estimatedReadTimeSec: 60,
      sourceId: overrides.sourceId === undefined ? `source-${id}` : overrides.sourceId,
      sourceTitle: 'Source',
      sourceUrl: 'https://source.example',
      originalUrl: 'https://article.example',
      publishedAt: new Date('2026-10-22T12:00:00.000Z'),
      createdAt: new Date('2026-10-22T12:00:00.000Z'),
      embedding,
      status: 'published',
      review: null,
    },
  };
}

describe('applyDiversity', () => {
  it('caps per source using the ordered ranking', () => {
    const selected = applyDiversity(
      [ranked('a', 1, [1, 0], { sourceId: 's1' }), ranked('b', 0.9, [1, 0], { sourceId: 's1' }), ranked('c', 0.8, [1, 0], { sourceId: 's1' })],
      { maxPerSource: 2, maxPerTopic: 10 },
    );

    expect(selected.map((entry) => entry.candidate.id)).toEqual(['a', 'b']);
  });

  it('treats cards without a source as one bucket', () => {
    const selected = applyDiversity(
      [ranked('a', 1, [1, 0], { sourceId: null }), ranked('b', 0.9, [1, 0], { sourceId: null }), ranked('c', 0.8, [1, 0], { sourceId: null })],
      { maxPerSource: 1, maxPerTopic: 10 },
    );

    expect(selected.map((entry) => entry.candidate.id)).toEqual(['a']);
  });

  it('skips a card when any of its topics is at the cap', () => {
    const selected = applyDiversity(
      [
        ranked('a', 1, [1, 0], { topicTags: ['shared'] }),
        ranked('b', 0.9, [1, 0], { topicTags: ['shared', 'other'] }),
        ranked('c', 0.8, [1, 0], { topicTags: ['shared'] }),
      ],
      { maxPerSource: 10, maxPerTopic: 1 },
    );

    expect(selected.map((entry) => entry.candidate.id)).toEqual(['a']);
  });

  it('rejects invalid caps', () => {
    expect(() => applyDiversity([], { maxPerSource: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_DIVERSITY_CAP' }),
    );
  });
});

describe('applyMmr', () => {
  it('prefers a semantically different card over a near duplicate', () => {
    const selected = applyMmr(
      [
        ranked('a', 1, [1, 0]),
        ranked('near-duplicate', 0.99, [1, 0]),
        ranked('different', 0.9, [0, 1]),
      ],
      0.5,
    );

    expect(selected[0]?.candidate.id).toBe('a');
    expect(selected[1]?.candidate.id).toBe('different');
    expect(selected[2]?.candidate.id).toBe('near-duplicate');
  });

  it('validates lambda', () => {
    expect(() => applyMmr([], 1.1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_MMR_LAMBDA' }),
    );
  });
});
