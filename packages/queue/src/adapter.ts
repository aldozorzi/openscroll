import type { JobName, JobPayloadMap } from './jobs';

export interface QueueJob<N extends JobName = JobName> {
  id: string;
  name: N;
  data: JobPayloadMap[N];
  retryCount: number;
  signal: AbortSignal;
}

export type JobHandler<N extends JobName> = (
  job: QueueJob<N>,
) => Promise<void>;

export interface EnqueueOptions {
  singletonKey?: string;
  startAfter?: Date | string | number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  priority?: number;
}

export interface WorkOptions {
  localConcurrency?: number;
  pollingIntervalSeconds?: number;
}

export interface QueueStats {
  name: string;
  queued: number;
  active: number;
  failed: number;
  completed: number;
}

export interface QueueAdapter {
  start(): Promise<void>;
  stop(options?: { graceful?: boolean; timeoutMs?: number }): Promise<void>;
  enqueue<N extends JobName>(
    name: N,
    data: JobPayloadMap[N],
    options?: EnqueueOptions,
  ): Promise<string | null>;
  work<N extends JobName>(
    name: N,
    handler: JobHandler<N>,
    options?: WorkOptions,
  ): Promise<string>;
  offWork(name: JobName): Promise<void>;
  schedule<N extends JobName>(
    name: N,
    cron: string,
    data: JobPayloadMap[N],
    options?: EnqueueOptions & { key?: string; timezone?: string },
  ): Promise<void>;
  unschedule(name: JobName, key?: string): Promise<void>;
  getQueueStats(name: JobName | string): Promise<QueueStats | null>;
  pendingJobCount(names: readonly JobName[]): Promise<number>;
}

export class PermanentJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}
