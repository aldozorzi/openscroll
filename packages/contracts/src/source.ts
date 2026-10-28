import { z } from 'zod';

export const SOURCE_TYPES = [
  'RSS',
  'ATOM',
  'JSON_FEED',
  'API',
  'READ_IT_LATER',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const MAX_SOURCE_URL_LENGTH = 2_048;

/**
 * Source URLs are user-controlled and later fetched by the worker. Validate
 * length and scheme here so invalid input fails at the API boundary, then let
 * canonicalizeUrl/safeFetch enforce the rest (credentials, SSRF, ports).
 */
export const SourceUrlSchema = z
  .string()
  .max(MAX_SOURCE_URL_LENGTH)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL must be a valid http or https URL');

export const SourceInputSchema = z.object({
  url: SourceUrlSchema,
  title: z.string().trim().min(1).max(255).optional(),
  category: z.string().trim().min(1).max(80).optional(),
});

export type SourceInput = z.infer<typeof SourceInputSchema>;

export const SourceSchema = z.object({
  id: z.uuid(),
  owner_id: z.uuid().nullable(),
  title: z.string(),
  url: z.string(),
  source_type: z.enum(SOURCE_TYPES),
  category: z.string().nullable(),
  is_public: z.boolean(),
  is_active: z.boolean(),
  last_fetched_at: z.string().nullable(),
  created_at: z.string(),
});

export type SourceRecord = z.infer<typeof SourceSchema>;
