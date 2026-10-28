import type { QueueAdapter } from './adapter';
import { createBullMqQueue } from './bullmq';
import { createInngestQueue, createQStashQueue } from './http-queue';
import { createPgBossQueue } from './pg-boss';

export type QueueDriver = 'pg-boss' | 'bullmq' | 'qstash' | 'inngest';

export interface QueueFactoryOptions {
  driver: QueueDriver;
  databaseUrl: string;
  redisUrl?: string;
  prefix?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookHost?: string;
  webhookPort?: number;
  qstashToken?: string;
  inngestEventKey?: string;
  inngestEventName?: string;
  applicationName?: string;
  maxConnections?: number;
  fetchImpl?: typeof fetch;
}

function requireOption(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required for this queue driver`);
  }
  return value;
}

export function createQueueAdapter(options: QueueFactoryOptions): QueueAdapter {
  switch (options.driver) {
    case 'pg-boss':
      return createPgBossQueue({
        connectionString: options.databaseUrl,
        ...(options.applicationName
          ? { applicationName: options.applicationName }
          : {}),
        ...(options.maxConnections
          ? { maxConnections: options.maxConnections }
          : {}),
      });
    case 'bullmq':
      return createBullMqQueue({
        connectionString: requireOption('REDIS_URL', options.redisUrl),
        ...(options.prefix ? { prefix: options.prefix } : {}),
      });
    case 'qstash':
      return createQStashQueue({
        token: requireOption('QSTASH_TOKEN', options.qstashToken),
        webhookUrl: requireOption('QUEUE_WEBHOOK_URL', options.webhookUrl),
        webhookSecret: requireOption(
          'QUEUE_WEBHOOK_SECRET',
          options.webhookSecret,
        ),
        ...(options.webhookHost ? { host: options.webhookHost } : {}),
        ...(options.webhookPort ? { port: options.webhookPort } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    case 'inngest':
      return createInngestQueue({
        eventKey: requireOption('INNGEST_EVENT_KEY', options.inngestEventKey),
        webhookUrl: requireOption('QUEUE_WEBHOOK_URL', options.webhookUrl),
        webhookSecret: requireOption(
          'QUEUE_WEBHOOK_SECRET',
          options.webhookSecret,
        ),
        ...(options.inngestEventName
          ? { eventName: options.inngestEventName }
          : {}),
        ...(options.webhookHost ? { host: options.webhookHost } : {}),
        ...(options.webhookPort ? { port: options.webhookPort } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
  }
}

export function queueOptionsFromEnv(env: {
  QUEUE_DRIVER: QueueDriver;
  DATABASE_URL: string;
  DIRECT_URL?: string;
  REDIS_URL?: string;
  BULLMQ_PREFIX: string;
  QUEUE_WEBHOOK_URL?: string;
  QUEUE_WEBHOOK_SECRET?: string;
  QUEUE_WEBHOOK_HOST: string;
  QUEUE_WEBHOOK_PORT: number;
  QSTASH_TOKEN?: string;
  INNGEST_EVENT_KEY?: string;
  INNGEST_EVENT_NAME: string;
}, applicationName: string): QueueFactoryOptions {
  return {
    driver: env.QUEUE_DRIVER,
    databaseUrl: env.DIRECT_URL ?? env.DATABASE_URL,
    ...(env.REDIS_URL ? { redisUrl: env.REDIS_URL } : {}),
    prefix: env.BULLMQ_PREFIX,
    ...(env.QUEUE_WEBHOOK_URL ? { webhookUrl: env.QUEUE_WEBHOOK_URL } : {}),
    ...(env.QUEUE_WEBHOOK_SECRET
      ? { webhookSecret: env.QUEUE_WEBHOOK_SECRET }
      : {}),
    webhookHost: env.QUEUE_WEBHOOK_HOST,
    webhookPort: env.QUEUE_WEBHOOK_PORT,
    ...(env.QSTASH_TOKEN ? { qstashToken: env.QSTASH_TOKEN } : {}),
    ...(env.INNGEST_EVENT_KEY
      ? { inngestEventKey: env.INNGEST_EVENT_KEY }
      : {}),
    inngestEventName: env.INNGEST_EVENT_NAME,
    applicationName,
  };
}
