import { z } from 'zod';

export const PreferencesSchema = z.object({
  topics: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  excludedTopics: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  language: z.string().trim().min(2).max(5).optional(),
});

export type PreferencesInput = z.infer<typeof PreferencesSchema>;
