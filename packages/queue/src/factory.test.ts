import { describe, expect, it } from 'vitest';
import { createQueueAdapter, queueOptionsFromEnv } from './factory';

const secret = 'a'.repeat(32);

describe('queue factory', () => {
  it('selects pg-boss by default from environment', () => {
    const options = queueOptionsFromEnv(
      {
        QUEUE_DRIVER: 'pg-boss',
        DATABASE_URL: 'postgres://pooled',
        DIRECT_URL: 'postgres://direct',
        BULLMQ_PREFIX: 'openscroll',
        QUEUE_WEBHOOK_HOST: '0.0.0.0',
        QUEUE_WEBHOOK_PORT: 3101,
        INNGEST_EVENT_NAME: 'openscroll/job',
      },
      'test-worker',
    );
    expect(options.databaseUrl).toBe('postgres://direct');
    expect(options.applicationName).toBe('test-worker');
    expect(createQueueAdapter(options)).toBeDefined();
  });

  it('requires provider-specific configuration', () => {
    expect(() =>
      createQueueAdapter({ driver: 'bullmq', databaseUrl: 'postgres://x' }),
    ).toThrow('REDIS_URL');
    expect(() =>
      createQueueAdapter({
        driver: 'qstash',
        databaseUrl: 'postgres://x',
        webhookUrl: 'https://example.com/jobs',
        webhookSecret: secret,
      }),
    ).toThrow('QSTASH_TOKEN');
    expect(() =>
      createQueueAdapter({
        driver: 'inngest',
        databaseUrl: 'postgres://x',
        webhookUrl: 'https://example.com/jobs',
        webhookSecret: secret,
      }),
    ).toThrow('INNGEST_EVENT_KEY');
  });

  it('constructs BullMQ without opening a connection until start', () => {
    const queue = createQueueAdapter({
      driver: 'bullmq',
      databaseUrl: 'postgres://x',
      redisUrl: 'redis://localhost:6379',
      prefix: 'test',
    });
    expect(queue).toBeDefined();
  });
});
