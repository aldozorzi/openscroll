import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDirectDatabaseUrl,
  getServerEnv,
  resetServerEnvForTests,
} from './env';

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvForTests();
});

beforeEach(() => {
  // Ensure test uses default environment by stubbing all relevant env vars
  vi.stubEnv('OPENSCROLL_USE_TEST_DB', undefined);
  vi.stubEnv('LLM_PROVIDER', undefined);
  vi.stubEnv('EMBEDDING_PROVIDER', undefined);
  vi.stubEnv('LLM_MODEL', undefined);
  vi.stubEnv('EMBEDDING_MODEL', undefined);
  vi.stubEnv('EMBEDDING_DIM', undefined);
  vi.stubEnv('LLM_DAILY_BUDGET_USD', undefined);
  vi.stubEnv('QUEUE_DRIVER', undefined);
  vi.stubEnv('QUEUE_WEBHOOK_PORT', undefined);
  vi.stubEnv('OPENROUTER_API_KEY', undefined);
  vi.stubEnv('OPENROUTER_BASE_URL', undefined);
  vi.stubEnv('OPENROUTER_APP_URL', undefined);
  vi.stubEnv('OPENROUTER_APP_NAME', undefined);
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', undefined);
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', undefined);
  vi.stubEnv('CLOUDFLARE_API_TOKEN', undefined);
  vi.stubEnv('MAX_LLM_TOKENS_PER_DAY', undefined);
  vi.stubEnv('MAX_EMBEDDING_TOKENS_PER_DAY', undefined);
  vi.stubEnv('LLM_DAILY_BUDGET_USD', undefined);
  vi.stubEnv('RAW_CONTENT_RETENTION_DAYS', undefined);
  vi.stubEnv('CLEANED_CONTENT_RETENTION_DAYS', undefined);
  vi.stubEnv('FEED_FRESHNESS_HALF_LIFE_DAYS', undefined);
  vi.stubEnv('QUEUE_DRIVER', undefined);
  vi.stubEnv('BULLMQ_PREFIX', undefined);
  vi.stubEnv('QUEUE_WEBHOOK_URL', undefined);
  vi.stubEnv('QUEUE_WEBHOOK_SECRET', undefined);
  vi.stubEnv('QUEUE_WEBHOOK_HOST', undefined);
  vi.stubEnv('QUEUE_WEBHOOK_PORT', undefined);
  vi.stubEnv('QSTASH_TOKEN', undefined);
  vi.stubEnv('INNGEST_EVENT_KEY', undefined);
  vi.stubEnv('INNGEST_EVENT_NAME', undefined);
  vi.stubEnv('UPSTASH_REDIS_REST_URL', undefined);
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', undefined);
  vi.stubEnv('REDIS_URL', undefined);
  vi.stubEnv('SENTRY_DSN', undefined);
  vi.stubEnv('RESEND_API_KEY', undefined);
  vi.stubEnv('RESEND_VERIFICATION_API_KEY', undefined);
  vi.stubEnv('EMAIL_FROM', undefined);
  vi.stubEnv('EMAIL_VERIFICATION_FROM', undefined);
  vi.stubEnv('VERIFICATION_EMAIL_DAILY_LIMIT', undefined);
  vi.stubEnv('NEXT_PUBLIC_APP_URL', undefined);
  vi.stubEnv('DIRECT_URL', undefined);
  vi.stubEnv('DATABASE_URL', undefined);
  vi.stubEnv('TRUST_PROXY', undefined);
  vi.stubEnv('AUTH_SECRET', undefined);
  vi.stubEnv('CRON_SECRET', undefined);
  vi.stubEnv('ADMIN_TOKEN', undefined);
  vi.stubEnv('TURNSTILE_SITE_KEY', undefined);
  vi.stubEnv('TURNSTILE_SECRET_KEY', undefined);
});

describe('server environment', () => {
  it('uses zero-cost defaults', () => {
    const env = getServerEnv();
    expect(env.EMBEDDING_PROVIDER).toBe('cloudflare');
    expect(env.EMBEDDING_DIM).toBe(1024);
    expect(env.LLM_PROVIDER).toBe('google');
    expect(env.LLM_DAILY_BUDGET_USD).toBe(0);
    expect(env.QUEUE_DRIVER).toBe('pg-boss');
    expect(env.QUEUE_WEBHOOK_PORT).toBe(3101);
    expect(env.VERIFICATION_EMAIL_DAILY_LIMIT).toBe(50);
  });

  it('prefers DIRECT_URL for migrations and queues', () => {
    vi.stubEnv('DIRECT_URL', 'postgresql://direct.example/openscroll');
    resetServerEnvForTests();
    expect(getDirectDatabaseUrl()).toBe(
      'postgresql://direct.example/openscroll',
    );
  });

  it('accepts OpenRouter configuration', () => {
    vi.stubEnv('LLM_PROVIDER', 'openrouter');
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    vi.stubEnv('LLM_MODEL', 'nvidia/nemotron-3.5-super-vl:free');
    resetServerEnvForTests();
    const env = getServerEnv();
    expect(env.LLM_PROVIDER).toBe('openrouter');
    expect(env.OPENROUTER_API_KEY).toBe('test-key');
  });

  it('rejects an unknown provider', () => {
    vi.stubEnv('LLM_PROVIDER', 'paid-provider');
    resetServerEnvForTests();
    expect(() => getServerEnv()).toThrow(/Invalid environment configuration/);
  });

  it('defaults TRUST_PROXY to false and parses explicit flags', () => {
    expect(getServerEnv().TRUST_PROXY).toBe(false);
    vi.stubEnv('TRUST_PROXY', 'true');
    resetServerEnvForTests();
    expect(getServerEnv().TRUST_PROXY).toBe(true);
  });

  it('refuses to boot production with development secrets', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'dev-only-change-me-0123456789abcdef0123456789abcdef');
    vi.stubEnv('CRON_SECRET', 'dev-only-change-me-cron-0123456789abcdef0123456789');
    vi.stubEnv('ADMIN_TOKEN', 'dev-only-change-me-admin-0123456789abcdef0123456789');
    resetServerEnvForTests();
    expect(() => getServerEnv()).toThrow(/must be replaced with a strong/);
  });

  it('refuses to boot production with reused secrets', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(40));
    vi.stubEnv('CRON_SECRET', 'a'.repeat(40));
    vi.stubEnv('ADMIN_TOKEN', 'b'.repeat(40));
    resetServerEnvForTests();
    expect(() => getServerEnv()).toThrow(/must all be different/);
  });

  it('accepts distinct strong secrets in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(40));
    vi.stubEnv('CRON_SECRET', 'b'.repeat(40));
    vi.stubEnv('ADMIN_TOKEN', 'c'.repeat(40));
    resetServerEnvForTests();
    expect(getServerEnv().NODE_ENV).toBe('production');
  });

  it('requires the Turnstile keys to be configured together', () => {
    vi.stubEnv('TURNSTILE_SITE_KEY', 'site-key');
    resetServerEnvForTests();
    expect(() => getServerEnv()).toThrow(
      /TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be configured together/,
    );

    vi.stubEnv('TURNSTILE_SITE_KEY', undefined);
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    resetServerEnvForTests();
    expect(() => getServerEnv()).toThrow(
      /TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be configured together/,
    );
  });

  it('accepts a complete Turnstile configuration', () => {
    vi.stubEnv('TURNSTILE_SITE_KEY', 'site-key');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    resetServerEnvForTests();
    const env = getServerEnv();
    expect(env.TURNSTILE_SITE_KEY).toBe('site-key');
    expect(env.TURNSTILE_SECRET_KEY).toBe('secret-key');
  });
});
