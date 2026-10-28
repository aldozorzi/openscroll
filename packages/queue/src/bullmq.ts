import { createHash } from 'node:crypto';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type {
  EnqueueOptions,
  JobHandler,
  QueueAdapter,
  QueueJob,
  QueueStats,
  WorkOptions,
} from './adapter';
import { PermanentJobError } from './adapter';
import {
  DEAD_LETTER_QUEUE,
  QUEUE_DEFINITIONS,
  type JobName,
  type JobPayloadMap,
} from './jobs';

export interface BullMqQueueOptions {
  connectionString: string;
  prefix?: string;
}

function jobIdFor(singletonKey: string): string {
  return createHash('sha256').update(singletonKey).digest('hex');
}

function backoff(
  retryDelay: number | undefined,
  retryBackoff: boolean | undefined,
): JobsOptions['backoff'] {
  if (retryDelay === undefined) {
    return undefined;
  }
  return {
    type: retryBackoff ? 'exponential' : 'fixed',
    delay: retryDelay * 1_000,
  };
}

export class BullMqQueueAdapter implements QueueAdapter {
  private readonly connectionString: string;
  private readonly prefix: string;
  private redis: Redis | null = null;
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private started = false;

  constructor(options: BullMqQueueOptions) {
    this.connectionString = options.connectionString;
    this.prefix = options.prefix ?? 'openscroll';
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.redis = new Redis(this.connectionString, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    await this.redis.ping();
    this.started = true;
  }

  async stop(options?: {
    graceful?: boolean;
    timeoutMs?: number;
  }): Promise<void> {
    const force = options?.graceful === false;
    const workers = [...this.workers.values()];
    this.workers.clear();
    await Promise.all(
      workers.map((worker) =>
        worker.close(force).catch(() => undefined),
      ),
    );

    const queues = [...this.queues.values()];
    this.queues.clear();
    await Promise.all(
      queues.map((queue) => queue.close().catch(() => undefined)),
    );

    if (this.redis) {
      const redis = this.redis;
      this.redis = null;
      await redis.quit().catch(() => redis.disconnect());
    }
    this.started = false;
  }

  private connection(): Redis {
    if (!this.redis || !this.started) {
      throw new Error('Queue adapter is not started');
    }
    return this.redis;
  }

  private queue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) {
      return existing;
    }
    const queue = new Queue(name, {
      connection: this.connection(),
      prefix: this.prefix,
    });
    this.queues.set(name, queue);
    return queue;
  }

  async enqueue<N extends JobName>(
    name: N,
    data: JobPayloadMap[N],
    options?: EnqueueOptions,
  ): Promise<string | null> {
    const definition = QUEUE_DEFINITIONS[name];
    const retryLimit = options?.retryLimit ?? definition.retryLimit;
    const retryDelay = options?.retryDelay ?? definition.retryDelay;
    const retryBackoff = options?.retryBackoff ?? definition.retryBackoff;
    const startAfter = options?.startAfter;
    const startAt =
      startAfter === undefined
        ? null
        : startAfter instanceof Date
          ? startAfter
          : new Date(startAfter);

    const jobOptions: JobsOptions = {
      attempts: retryLimit + 1,
      backoff: backoff(retryDelay, retryBackoff),
      removeOnComplete: { age: definition.deleteAfterSeconds, count: 10_000 },
      removeOnFail: false,
      ...(options?.priority !== undefined
        ? { priority: options.priority }
        : {}),
      ...(options?.singletonKey
        ? { jobId: jobIdFor(options.singletonKey) }
        : {}),
      ...(startAt
        ? { delay: Math.max(0, startAt.getTime() - Date.now()) }
        : {}),
    };

    const job = await this.queue(name).add(name, data, jobOptions);
    return job.id ?? null;
  }

  async work<N extends JobName>(
    name: N,
    handler: JobHandler<N>,
    options?: WorkOptions,
  ): Promise<string> {
    const worker = new Worker(
      name,
      async (job: Job<JobPayloadMap[N]>) => {
        const controller = new AbortController();
        const envelope: QueueJob<N> = {
          id: job.id ?? '',
          name,
          data: job.data,
          retryCount: job.attemptsMade,
          signal: controller.signal,
        };
        try {
          await handler(envelope);
          return { ok: true };
        } catch (error) {
          if (error instanceof PermanentJobError) {
            await job.discard();
          }
          throw error;
        }
      },
      {
        connection: this.connection(),
        prefix: this.prefix,
        concurrency: options?.localConcurrency ?? 1,
      },
    );

    worker.on('failed', (job, error) => {
      if (!job) {
        return;
      }
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < attempts) {
        return;
      }
      void this.queue(DEAD_LETTER_QUEUE)
        .add(
          job.name,
          {
            jobId: job.id,
            name: job.name,
            data: job.data,
            error: error.message,
          },
          {
            removeOnComplete: {
              age: QUEUE_DEFINITIONS[DEAD_LETTER_QUEUE].deleteAfterSeconds,
            },
            removeOnFail: false,
          },
        )
        .catch((deadLetterError: unknown) => {
          console.error(
            JSON.stringify({
              level: 'error',
              event: 'dead_letter_enqueue_failed',
              jobId: job.id,
              message:
                deadLetterError instanceof Error
                  ? deadLetterError.message
                  : 'Unknown error',
            }),
          );
        });
    });

    worker.on('error', (error) => {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'queue_worker_error',
          queue: name,
          message: error.message,
        }),
      );
    });

    this.workers.set(name, worker);
    return name;
  }

  async offWork(name: JobName): Promise<void> {
    const worker = this.workers.get(name);
    if (!worker) {
      return;
    }
    this.workers.delete(name);
    await worker.close();
  }

  async schedule<N extends JobName>(
    name: N,
    cron: string,
    data: JobPayloadMap[N],
    options?: EnqueueOptions & { key?: string; timezone?: string },
  ): Promise<void> {
    const definition = QUEUE_DEFINITIONS[name];
    const retryLimit = options?.retryLimit ?? definition.retryLimit;
    const retryDelay = options?.retryDelay ?? definition.retryDelay;

    await this.queue(name).upsertJobScheduler(
      options?.key ?? name,
      {
        pattern: cron,
        ...(options?.timezone ? { tz: options.timezone } : {}),
      },
      {
        name,
        data,
        opts: {
          attempts: retryLimit + 1,
          backoff: backoff(
            retryDelay,
            options?.retryBackoff ?? definition.retryBackoff,
          ),
          removeOnComplete: {
            age: definition.deleteAfterSeconds,
            count: 1_000,
          },
          removeOnFail: false,
        },
      },
    );
  }

  async unschedule(name: JobName, key?: string): Promise<void> {
    await this.queue(name).removeJobScheduler(key ?? name);
  }

  async getQueueStats(name: JobName | string): Promise<QueueStats | null> {
    const counts = await this.queue(name).getJobCounts(
      'waiting',
      'active',
      'failed',
      'completed',
      'delayed',
      'prioritized',
    );
    return {
      name,
      queued:
        Number(counts.waiting ?? 0) +
        Number(counts.delayed ?? 0) +
        Number(counts.prioritized ?? 0),
      active: Number(counts.active ?? 0),
      failed: Number(counts.failed ?? 0),
      completed: Number(counts.completed ?? 0),
    };
  }

  async pendingJobCount(names: readonly JobName[]): Promise<number> {
    const counts = await Promise.all(
      names.map(async (name) => {
        const value = await this.queue(name).getJobCounts(
          'waiting',
          'active',
          'delayed',
          'prioritized',
          'waiting-children',
        );
        return (
          Number(value.waiting ?? 0) +
          Number(value.active ?? 0) +
          Number(value.delayed ?? 0) +
          Number(value.prioritized ?? 0) +
          Number(value['waiting-children'] ?? 0)
        );
      }),
    );
    return counts.reduce((sum, value) => sum + value, 0);
  }
}

export function createBullMqQueue(options: BullMqQueueOptions): QueueAdapter {
  return new BullMqQueueAdapter(options);
}
