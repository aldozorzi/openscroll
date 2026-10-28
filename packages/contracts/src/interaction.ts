import { z } from 'zod';

export const INTERACTION_TYPES = [
  'VIEW',
  'LIKE',
  'DISLIKE',
  'DISMISS',
  'CLICK_SOURCE',
  'SAVE',
  'UNSAVE',
] as const;

export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const InteractionSchema = z.object({
  interaction_type: z.enum(INTERACTION_TYPES),
  dwell_time_ms: z.number().int().min(0).max(300_000).default(0),
});

export type InteractionInput = z.infer<typeof InteractionSchema>;

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14] as const;

export type ReviewIntervalDays = (typeof REVIEW_INTERVAL_DAYS)[number];

export const ReviewSchema = z.object({
  interval_days: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]),
});

export type ReviewInput = z.infer<typeof ReviewSchema>;
