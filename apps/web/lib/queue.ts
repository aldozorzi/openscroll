import { getServerEnv } from '@openscroll/config';
import {
  createQueueAdapter,
  queueOptionsFromEnv,
  type EnqueueOptions,
  type JobName,
  type JobPayloadMap,
  type QueueAdapter,
  type QueueStats,
} from '@openscroll/queue';

const globalForQueue = globalThis as typeof globalThis & {
  __openscrollQueue?: Promise<QueueAdapter>;
};

async function getQueue(): Promise<QueueAdapter> {
  if (!globalForQueue.__openscrollQueue) {
    const queue = createQueueAdapter({
      ...queueOptionsFromEnv(getServerEnv(), 'openscroll-web'),
      maxConnections: 2,
    });
    globalForQueue.__openscrollQueue = queue
      .start()
      .then(() => queue)
      .catch((error: unknown) => {
        globalForQueue.__openscrollQueue = undefined;
        throw error;
      });
  }
  return globalForQueue.__openscrollQueue;
}

export async function enqueueJob<N extends JobName>(
  name: N,
  data: JobPayloadMap[N],
  options?: EnqueueOptions,
): Promise<string | null> {
  if (process.env.NODE_ENV === 'test' && process.env.RUN_QUEUE_TESTS !== '1') {
    return null;
  }

  const queue = await getQueue();
  return queue.enqueue(name, data, options);
}

export async function enqueueSafely<N extends JobName>(
  name: N,
  data: JobPayloadMap[N],
  options?: EnqueueOptions,
): Promise<string | null> {
  try {
    return await enqueueJob(name, data, options);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'enqueue_failed',
        jobName: name,
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    return null;
  }
}

export async function getQueueStats(
  names: readonly string[],
): Promise<QueueStats[]> {
  const queue = await getQueue();
  const stats = await Promise.all(names.map((name) => queue.getQueueStats(name)));
  return stats.filter((value): value is QueueStats => value !== null);
}

export async function getQueuePendingCount(
  names: readonly JobName[],
): Promise<number> {
  const queue = await getQueue();
  return queue.pendingJobCount(names);
}

export async function closeQueueForTests(): Promise<void> {
  const pending = globalForQueue.__openscrollQueue;
  if (!pending) {
    return;
  }
  globalForQueue.__openscrollQueue = undefined;
  try {
    const queue = await pending;
    await queue.stop({ graceful: false, timeoutMs: 5_000 });
  } catch {
    // The queue may never have started.
  }
}
