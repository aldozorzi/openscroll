import { describe, expect, it } from 'vitest';
import { cards, providerUsage, userCardReviews } from './schema';

describe('database schema', () => {
  it('stores card reading time and review state', () => {
    expect(cards.estimatedReadTimeSec.name).toBe('estimated_read_time_sec');
    expect(userCardReviews.nextReview.name).toBe('next_review');
  });

  it('tracks provider usage per provider, metric, and day', () => {
    expect(providerUsage.usageDate.name).toBe('usage_date');
    expect(providerUsage.value.name).toBe('value');
  });
});
