import pg from 'pg';
import { PgBoss, type Job, type QueueStats } from 'pg-boss';
import type {
  EnqueueOptions,
  JobHandler,
  QueueAdapter,
  QueueJob,
  QueueStats as QueueStatsSummary,
  WorkOptions,
} from './adapter';
import { PermanentJobError } from './adapter';
import {
  DEAD_LETTER_QUEUE,
  QUEUE_DEFINITIONS,
  type JobName,
  type JobPayloadMap,
} from './jobs';

export interface PgBossQueueOptions {
  connectionString: string;
  schema?: string;
  maxConnections?: number;
  applicationName?: string;
}

export class PgBossQueueAdapter implements QueueAdapter {
  private readonly boss: PgBoss;
  private readonly connectionString: string;
  private readonly schema: string;
  private started = false;
  private statsPool: pg.Pool | null = null;

  constructor(options: PgBossQueueOptions) {
    this.connectionString = options.connectionString;
    this.schema = options.schema ?? 'pgboss';
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      schema: this.schema,
      max: options.maxConnections ?? 5,
      application_name: options.applicationName ?? 'openscroll-queue',
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.boss.start();
    this.started = true;

    const definitions = Object.entries(QUEUE_DEFINITIONS);
    definitions.sort(([a], [b]) => {
      if (a === DEAD_LETTER_QUEUE) return -1;
      if (b === DEAD_LETTER_QUEUE) return 1;
      return 0;
    });

    for (const [name, definition] of definitions) {
      await this.boss.createQueue(name, {
        policy: definition.policy,
        retryLimit: definition.retryLimit,
        retryDelay: definition.retryDelay,
        retryBackoff: definition.retryBackoff ?? false,
        expireInSeconds: definition.expireInSeconds,
        deleteAfterSeconds: definition.deleteAfterSeconds,
        ...(name === DEAD_LETTER_QUEUE
          ? {}
          : { deadLetter: DEAD_LETTER_QUEUE }),
      });
    }
  }

  async stop(options?: {
    graceful?: boolean;
    timeoutMs?: number;
  }): Promise<void> {
    try {
      if (this.started) {
        await this.boss.stop({
          graceful: options?.graceful ?? true,
          timeout: options?.timeoutMs,
        });
      }
    } finally {
      this.started = false;
      if (this.statsPool) {
        const pool = this.statsPool;
        this.statsPool = null;
        await pool.end();
      }
    }
  }

  async enqueue<N extends JobName>(
    name: N,
    data: JobPayloadMap[N],
    options?: EnqueueOptions,
  ): Promise<string | null> {
    return this.boss.send(name, data, {
      ...(options?.singletonKey
        ? { singletonKey: options.singletonKey }
        : {}),
      ...(options?.startAfter !== undefined
        ? { startAfter: options.startAfter }
        : {}),
      ...(options?.retryLimit !== undefined
        ? { retryLimit: options.retryLimit }
        : {}),
      ...(options?.retryDelay !== undefined
        ? { retryDelay: options.retryDelay }
        : {}),
      ...(options?.retryBackoff !== undefined
        ? { retryBackoff: options.retryBackoff }
        : {}),
      ...(options?.expireInSeconds !== undefined
        ? { expireInSeconds: options.expireInSeconds }
        : {}),
      ...(options?.priority !== undefined
        ? { priority: options.priority }
        : {}),
    });
  }

  async work<N extends JobName>(
    name: N,
    handler: JobHandler<N>,
    options?: WorkOptions,
  ): Promise<string> {
    return this.boss.work(
      name,
      {
        localConcurrency: options?.localConcurrency ?? 1,
        pollingIntervalSeconds: options?.pollingIntervalSeconds ?? 2,
        perJobResults: true,
      },
      async (jobs: Job<JobPayloadMap[N]>[]) => {
        const results = [];

        for (const job of jobs) {
          try {
            await handler({
              id: job.id,
              name,
              data: job.data,
              retryCount: job.retryCount,
              signal: job.signal,
            });
            results.push({ id: job.id, status: 'completed' as const });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'Unknown handler error';
            results.push({
              id: job.id,
              status:
                error instanceof PermanentJobError
                  ? ('deadletter' as const)
                  : ('failed' as const),
              output: { message },
            });
          }
        }

        return results;
      },
    );
  }

  async offWork(name: JobName): Promise<void> {
    await this.boss.offWork(name);
  }

  async schedule<N extends JobName>(
    name: N,
    cron: string,
    data: JobPayloadMap[N],
    options?: EnqueueOptions & { key?: string; timezone?: string },
  ): Promise<void> {
    await this.boss.schedule(name, cron, data, {
      ...(options?.key ? { key: options.key } : {}),
      ...(options?.timezone ? { tz: options.timezone } : {}),
      ...(options?.singletonKey
        ? { singletonKey: options.singletonKey }
        : {}),
      ...(options?.retryLimit !== undefined
        ? { retryLimit: options.retryLimit }
        : {}),
      ...(options?.retryDelay !== undefined
        ? { retryDelay: options.retryDelay }
        : {}),
      ...(options?.retryBackoff !== undefined
        ? { retryBackoff: options.retryBackoff }
        : {}),
    });
  }

  async unschedule(name: JobName, key?: string): Promise<void> {
    await this.boss.unschedule(name, key);
  }

  async getQueueStats(
    name: JobName | string,
  ): Promise<QueueStatsSummary | null> {
    const [stats] = await this.boss.getQueueStats(name, { force: true });
    return stats ? toSummary(stats) : null;
  }

  async pendingJobCount(names: readonly JobName[]): Promise<number> {
    if (names.length === 0) {
      return 0;
    }

    this.statsPool ??= new pg.Pool({
      connectionString: this.connectionString,
      max: 1,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    const table = `${pg.escapeIdentifier(this.schema)}.${pg.escapeIdentifier('job')}`;
    const result = await this.statsPool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM ${table}
        WHERE name = ANY($1::text[])
          AND state IN ('created', 'retry', 'active')`,
      [names],
    );

    return Number(result.rows[0]?.count ?? 0);
  }
}

function toSummary(stats: QueueStats): QueueStatsSummary {
  return {
    name: stats.name,
    queued: stats.queuedCount,
    active: stats.activeCount,
    failed: stats.failedCount,
    completed: stats.completedDelta ?? 0,
  };
}

export function createPgBossQueue(
  options: PgBossQueueOptions,
): QueueAdapter {
  return new PgBossQueueAdapter(options);
}
