import type { WorkerContext } from '../context';
import { generateCard } from './generate-card';
import { ingestSource } from './ingest-source';
import { processArticle } from './process-article';
import { recomputeUserVector } from './recompute-user-vector';
import { retentionCleanup } from './retention-cleanup';

export { generateCard, ingestSource, processArticle, recomputeUserVector, retentionCleanup };

export async function registerHandlers(
  ctx: WorkerContext,
): Promise<string[]> {
  return Promise.all([
    ctx.queue.work(
      'ingest-source',
      (job) => ingestSource(ctx, job.data.sourceId),
      { localConcurrency: 1 },
    ),
    ctx.queue.work(
      'process-article',
      (job) => processArticle(ctx, job.data.articleId, job.signal),
      { localConcurrency: 1 },
    ),
    ctx.queue.work(
      'generate-card',
      (job) => generateCard(ctx, job.data.articleId, job.signal),
      { localConcurrency: 1 },
    ),
    ctx.queue.work(
      'recompute-user-vector',
      (job) => recomputeUserVector(ctx, job.data.userId, job.signal),
      { localConcurrency: 1 },
    ),
    ctx.queue.work(
      'retention-cleanup',
      () => retentionCleanup(ctx).then(() => undefined),
      { localConcurrency: 1 },
    ),
  ]);
}
