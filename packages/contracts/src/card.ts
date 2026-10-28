import { z } from 'zod';

export const MicroCardSchema = z.object({
  hook: z
    .string()
    .trim()
    .min(10)
    .max(120)
    .describe('A high-impact question or punchy statement'),
  core_concept: z
    .string()
    .trim()
    .refine((value) => {
      const words = value.split(/\s+/).filter(Boolean).length;
      return words >= 80 && words <= 120;
    }, 'core_concept must contain 80-120 words'),
  key_takeaways: z.array(z.string().trim().min(5).max(140)).min(1).max(3),
  topic_tags: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
  language: z.string().trim().min(2).max(5),
});

export type MicroCard = z.infer<typeof MicroCardSchema>;

export function estimateReadTimeSec(
  card: Pick<MicroCard, 'core_concept'>,
): number {
  const words = card.core_concept.split(/\s+/).filter(Boolean).length;
  return Math.max(20, Math.round(words / 3.5));
}

export const CardRecordSchema = MicroCardSchema.extend({
  id: z.uuid(),
  article_id: z.uuid(),
  estimated_read_time_sec: z.number().int().positive(),
  embedding_model: z.string().nullable(),
  embedding_dim: z.number().int().positive().nullable(),
  created_at: z.string(),
});

export type CardRecord = z.infer<typeof CardRecordSchema>;
