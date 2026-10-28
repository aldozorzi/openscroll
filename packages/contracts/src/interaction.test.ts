import { describe, expect, it } from 'vitest';
import { InteractionSchema, ReviewSchema } from './interaction';

describe('interaction contracts', () => {
  it('clamps dwell time to the accepted range', () => {
    expect(
      InteractionSchema.safeParse({
        interaction_type: 'VIEW',
        dwell_time_ms: 300_001,
      }).success,
    ).toBe(false);
  });

  it('accepts only review intervals 1,3,7,14 days', () => {
    expect(ReviewSchema.safeParse({ interval_days: 3 }).success).toBe(true);
    expect(ReviewSchema.safeParse({ interval_days: 5 }).success).toBe(false);
    expect(ReviewSchema.safeParse({ interval_days: 0 }).success).toBe(false);
  });
});
