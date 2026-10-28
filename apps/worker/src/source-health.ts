import { eq } from 'drizzle-orm';
import { sources } from '@openscroll/db';
import type { WorkerContext } from './context';

export const SOURCE_FAILURE_THRESHOLD = 3;
export const SOURCE_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const SOURCE_ERROR_MAX_LENGTH = 1_000;

export function nextFailureCount(
  current: number,
  lastFailureAt: Date | null,
  now: Date,
): number {
  if (
    current > 0 &&
    lastFailureAt &&
    now.getTime() - lastFailureAt.getTime() < SOURCE_FAILURE_WINDOW_MS
  ) {
    return current;
  }
  return current + 1;
}

export function shouldDeactivateSource(consecutiveFailures: number): boolean {
  return consecutiveFailures >= SOURCE_FAILURE_THRESHOLD;
}

export function sourceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, SOURCE_ERROR_MAX_LENGTH);
}

export async function recordSourceFailure(
  ctx: WorkerContext,
  source: {
    id: string;
    title: string;
    consecutiveFailures: number;
    lastFailureAt: Date | null;
  },
  error: unknown,
  now: Date,
): Promise<number> {
  const consecutiveFailures = nextFailureCount(
    source.consecutiveFailures,
    source.lastFailureAt,
    now,
  );
  const deactivate = shouldDeactivateSource(consecutiveFailures);
  const lastError = sourceErrorMessage(error);

  await ctx.db
    .update(sources)
    .set({
      consecutiveFailures,
      lastFailureAt: now,
      lastError,
      updatedAt: now,
      ...(deactivate ? { isActive: false, nextFetchAt: null } : {}),
    })
    .where(eq(sources.id, source.id));

  if (deactivate) {
    ctx.logger.warn('source_auto_deactivated', {
      sourceId: source.id,
      title: source.title,
      consecutiveFailures,
      lastError,
    });
  } else {
    ctx.logger.warn('source_failure_recorded', {
      sourceId: source.id,
      title: source.title,
      consecutiveFailures,
      lastError,
    });
  }

  return consecutiveFailures;
}
