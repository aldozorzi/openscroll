import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const nonEmpty = z.string().trim().min(1);

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().optional(),
);

const optionalBoundedString = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const booleanFlag = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['', '0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const DEV_SECRET_PREFIX = 'dev-only-change-me';
const SECRET_KEYS = ['AUTH_SECRET', 'CRON_SECRET', 'ADMIN_TOKEN'] as const;

function loadTestEnvIfExists(): Partial<NodeJS.ProcessEnv> | null {
  if (process.env.OPENSCROLL_USE_TEST_DB !== 'true') {
    return null;
  }
  try {
    const envFile = join(tmpdir(), 'openscroll-test-env.json');
    const content = readFileSync(envFile, 'utf-8');
    const testEnv = JSON.parse(content);
    // Merge with process.env LAST so vi.stubEnv in tests takes precedence
    return { ...testEnv, ...process.env };
  } catch {
    return null;
  }
}

function getEnvSource(): NodeJS.ProcessEnv {
  const testEnv = loadTestEnvIfExists();
  return (testEnv ?? process.env) as NodeJS.ProcessEnv;
}

export const serverEnvSchema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: nonEmpty.default(
    'postgresql://openscroll:openscroll@localhost:5432/openscroll',
  ),
  DIRECT_URL: z.preprocess(emptyToUndefined, nonEmpty.optional()),

  AUTH_SECRET: z
    .string()
    .min(32)
    .default('dev-only-change-me-0123456789abcdef0123456789abcdef'),
  CRON_SECRET: z
    .string()
    .min(16)
    .default('dev-only-change-me-cron-0123456789abcdef0123456789'),
  ADMIN_TOKEN: z
    .string()
    .min(16)
    .default('dev-only-change-me-admin-0123456789abcdef0123456789'),

  EMBEDDING_PROVIDER: z.enum(['cloudflare', 'mock']).default('cloudflare'),
  CLOUDFLARE_ACCOUNT_ID: optionalString,
  CLOUDFLARE_API_TOKEN: optionalString,
  EMBEDDING_MODEL: z.string().trim().default('@cf/baai/bge-m3'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),

  LLM_PROVIDER: z
    .enum(['google', 'cloudflare', 'openrouter', 'mock'])
    .default('google'),
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
  OPENROUTER_BASE_URL: optionalUrl,
  OPENROUTER_APP_URL: optionalUrl,
  OPENROUTER_APP_NAME: optionalString,
  LLM_MODEL: z.string().trim().default('gemini-2.5-flash-lite'),

  MAX_LLM_TOKENS_PER_DAY: z.coerce.number().int().positive().default(200_000),
  MAX_EMBEDDING_TOKENS_PER_DAY: z.coerce
    .number()
    .int()
    .positive()
    .default(1_000_000),
  LLM_DAILY_BUDGET_USD: z.coerce.number().min(0).default(0),

  RAW_CONTENT_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  CLEANED_CONTENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  FEED_FRESHNESS_HALF_LIFE_DAYS: z.coerce.number().positive().default(14),

  QUEUE_DRIVER: z
    .enum(['pg-boss', 'bullmq', 'qstash', 'inngest'])
    .default('pg-boss'),
  BULLMQ_PREFIX: z.string().trim().default('openscroll'),
  QUEUE_WEBHOOK_URL: optionalUrl,
  QUEUE_WEBHOOK_SECRET: optionalString,
  QUEUE_WEBHOOK_HOST: z.string().trim().default('0.0.0.0'),
  QUEUE_WEBHOOK_PORT: z.coerce.number().int().positive().default(3101),
  QSTASH_TOKEN: optionalString,
  INNGEST_EVENT_KEY: optionalString,
  INNGEST_EVENT_NAME: z.string().trim().default('openscroll/job'),

  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  REDIS_URL: optionalString,
  SENTRY_DSN: optionalUrl,
  RESEND_API_KEY: optionalString,
  RESEND_VERIFICATION_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  EMAIL_VERIFICATION_FROM: optionalString,
  // Hard budget on verification emails across all users. Keeps an attacker
  // from turning registration into an outbound spam/quota-exhaustion vector.
  VERIFICATION_EMAIL_DAILY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(50),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // Cloudflare Turnstile for the registration CAPTCHA. Site key is public; the
  // secret key is server-only. Both must be set together or omitted together.
  TURNSTILE_SITE_KEY: optionalBoundedString(256),
  TURNSTILE_SECRET_KEY: optionalBoundedString(256),

  // Only enable when the app is reachable exclusively through a trusted reverse
  // proxy that overwrites X-Forwarded-For / X-Real-IP / CF-Connecting-IP.
  TRUST_PROXY: booleanFlag.default(false),
})
  .superRefine((env, ctx) => {
    if (Boolean(env.TURNSTILE_SITE_KEY) !== Boolean(env.TURNSTILE_SECRET_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: [
          env.TURNSTILE_SITE_KEY
            ? 'TURNSTILE_SECRET_KEY'
            : 'TURNSTILE_SITE_KEY',
        ],
        message:
          'TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be configured together',
      });
    }

    if (env.NODE_ENV !== 'production') {
      return;
    }

    for (const key of SECRET_KEYS) {
      const value = env[key];
      if (value.startsWith(DEV_SECRET_PREFIX)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be replaced with a strong, unique value in production`,
        });
      }
      if (value.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be at least 32 characters in production`,
        });
      }
    }

    if (new Set(SECRET_KEYS.map((key) => env[key])).size !== SECRET_KEYS.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'AUTH_SECRET, CRON_SECRET and ADMIN_TOKEN must all be different',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) {
    return cached;
  }

  const parsed = serverEnvSchema.safeParse(getEnvSource());
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cached = parsed.data;
  return cached;
}

export function getDirectDatabaseUrl(env: ServerEnv = getServerEnv()): string {
  return env.DIRECT_URL ?? env.DATABASE_URL;
}

export function resetServerEnvForTests(): void {
  cached = null;
}
