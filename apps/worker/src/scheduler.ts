import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { sources } from '@openscroll/db';
import { sourceSingletonKey } from '@openscroll/queue';
import type { WorkerContext } from './context';

const DEFAULT_SOURCE_LIMIT = 100;

export async function enqueueDueSources(
  ctx: WorkerContext,
  limit = DEFAULT_SOURCE_LIMIT,
): Promise<number> {
  const now = ctx.now();
  const due = await ctx.db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.isActive, true),
        or(isNull(sources.nextFetchAt), lte(sources.nextFetchAt, now)),
      ),
    )
    .limit(limit);

  let enqueued = 0;
  for (const source of due) {
    const jobId = await ctx.queue.enqueue(
      'ingest-source',
      { sourceId: source.id },
      { singletonKey: sourceSingletonKey(source.id) },
    );
    if (jobId) {
      enqueued += 1;
    }
  }

  ctx.logger.info('source_schedule_completed', {
    due: due.length,
    enqueued,
  });
  return enqueued;
}

export function retentionSingletonKey(now: Date): string {
  return `retention:${now.toISOString().slice(0, 10)}`;
}

export async function enqueueRetentionCleanup(
  ctx: WorkerContext,
): Promise<boolean> {
  const now = ctx.now();
  const jobId = await ctx.queue.enqueue(
    'retention-cleanup',
    { requestedAt: now.toISOString() },
    { singletonKey: retentionSingletonKey(now) },
  );
  return jobId !== null;
}

export async function scheduleDueWork(ctx: WorkerContext): Promise<void> {
  await enqueueDueSources(ctx);
  const retentionQueued = await enqueueRetentionCleanup(ctx);
  ctx.logger.info('worker_schedule_completed', { retentionQueued });
}
