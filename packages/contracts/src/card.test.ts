import { describe, expect, it } from 'vitest';
import { MicroCardSchema, estimateReadTimeSec } from './card';

const validCard = {
  hook: 'Why do distributed systems need idempotency?',
  core_concept: Array.from({ length: 90 }, () => 'word').join(' '),
  key_takeaways: ['Retries are inevitable', 'Duplicate work must be safe'],
  topic_tags: ['distributed systems', 'reliability'],
  language: 'en',
};

describe('MicroCardSchema', () => {
  it('accepts a valid card', () => {
    expect(MicroCardSchema.safeParse(validCard).success).toBe(true);
  });

  it('rejects a core concept outside the 80-120 word range', () => {
    const result = MicroCardSchema.safeParse({
      ...validCard,
      core_concept: 'too short',
    });
    expect(result.success).toBe(false);
  });

  it('computes reading time from the core concept', () => {
    expect(estimateReadTimeSec(validCard)).toBe(26);
  });
});
