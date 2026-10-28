import { setTimeout as sleep } from 'node:timers/promises';
import type { JobName } from '@openscroll/queue';
import type { WorkerContext } from './context';

export const WORK_QUEUES: readonly JobName[] = [
  'ingest-source',
  'process-article',
  'generate-card',
  'recompute-user-vector',
  'retention-cleanup',
];

export interface DrainOptions {
  timeoutMs?: number;
  pollMs?: number;
  requireEmptyPolls?: number;
}

export async function queuesAreEmpty(ctx: WorkerContext): Promise<boolean> {
  return (await ctx.queue.pendingJobCount(WORK_QUEUES)) === 0;
}

export async function waitForDrain(
  ctx: WorkerContext,
  options: DrainOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const pollMs = options.pollMs ?? 1_500;
  const requireEmptyPolls = options.requireEmptyPolls ?? 2;
  const deadline = Date.now() + timeoutMs;
  let emptyPolls = 0;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (await queuesAreEmpty(ctx)) {
      emptyPolls += 1;
      if (emptyPolls >= requireEmptyPolls) {
        return;
      }
    } else {
      emptyPolls = 0;
    }
  }

  throw new Error(
    `Queue drain timed out after ${Math.round(timeoutMs / 1000)}s`,
  );
}
