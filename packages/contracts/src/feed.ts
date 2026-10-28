import { z } from 'zod';

export const FEED_MODES = ['learn', 'review', 'mixed'] as const;

export type FeedMode = (typeof FEED_MODES)[number];

export const MAX_CURSOR_LENGTH = 1_024;

export const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
  mode: z.enum(FEED_MODES).default('mixed'),
});

export type FeedQuery = z.infer<typeof FeedQuerySchema>;

export const FeedCardSchema = z.object({
  id: z.uuid(),
  articleId: z.uuid(),
  hook: z.string(),
  coreConcept: z.string(),
  keyTakeaways: z.array(z.string()),
  topicTags: z.array(z.string()),
  language: z.string().nullable(),
  estimatedReadTimeSec: z.number().int().positive(),
  sourceTitle: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  originalUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  score: z.number(),
});

export type FeedCard = z.infer<typeof FeedCardSchema>;

export const FeedResponseSchema = z.object({
  cards: z.array(FeedCardSchema),
  nextCursor: z.string().nullable(),
});

export type FeedResponse = z.infer<typeof FeedResponseSchema>;
