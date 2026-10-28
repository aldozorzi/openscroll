import './load-env';
import { DEAD_LETTER_QUEUE, sourceSingletonKey } from '@openscroll/queue';
import { createWorkerContext, type WorkerContext } from './context';
import { waitForDrain } from './drain';
import { registerHandlers } from './handlers';
import { processArticlesCommand } from './process-articles';
import type { Logger } from './logger';
import { scheduleDueWork } from './scheduler';
import { truncateError } from './transform';

const SOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'run';
  const commandArgs = args.slice(1);

  if (command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const ctx = createWorkerContext();
  let cleanedUp = false;

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    await ctx.queue
      .stop({ graceful: true, timeoutMs: 30_000 })
      .catch((error: unknown) => {
        ctx.logger.error('queue_stop_failed', {
          message: truncateError(error),
        });
      });
    await ctx.pool.end().catch((error: unknown) => {
      ctx.logger.error('database_close_failed', {
        message: truncateError(error),
      });
    });
  };

  const shutdown = (signal: string): void => {
    ctx.logger.info('worker_shutdown_requested', { signal });
    void cleanup().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  try {
    switch (command) {
      case 'run':
      case 'start':
      case 'drain':
        await runOnce(ctx);
        break;
      case 'watch':
        await runWatch(ctx);
        break;
      case 'schedule':
        await runSchedule(ctx);
        break;
      case 'enqueue-source':
        await runEnqueueSource(ctx, commandArgs[0]);
        break;
      case 'process-articles':
        await runProcessArticles(ctx, commandArgs);
        break;
      default:
        printUsage();
        process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

async function runOnce(ctx: WorkerContext): Promise<void> {
  ctx.logger.info('worker_run_started', {
    llmProvider: ctx.llm.name,
    embeddingProvider: ctx.embedding.name,
  });

  await ctx.queue.start();
  await registerHandlers(ctx);
  await scheduleDueWork(ctx);
  await waitForDrain(ctx);

  const deadLetter = await ctx.queue.getQueueStats(DEAD_LETTER_QUEUE);
  if (
    deadLetter &&
    (deadLetter.queued > 0 || deadLetter.active > 0 || deadLetter.failed > 0)
  ) {
    ctx.logger.warn('dead_letter_has_jobs', {
      queued: deadLetter.queued,
      active: deadLetter.active,
      failed: deadLetter.failed,
    });
  }

  ctx.logger.info('worker_run_completed');
}

async function runWatch(ctx: WorkerContext): Promise<void> {
  await ctx.queue.start();
  await registerHandlers(ctx);
  await scheduleDueWork(ctx);

  const interval = setInterval(() => {
    void scheduleDueWork(ctx).catch((error: unknown) => {
      ctx.logger.error('worker_schedule_failed', {
        message: truncateError(error),
      });
    });
  }, 60_000);

  process.once('SIGINT', () => clearInterval(interval));
  process.once('SIGTERM', () => clearInterval(interval));

  ctx.logger.info('worker_watch_started', {
    llmProvider: ctx.llm.name,
    embeddingProvider: ctx.embedding.name,
  });

  await new Promise<void>(() => {});
}

async function runSchedule(ctx: WorkerContext): Promise<void> {
  await ctx.queue.start();
  await scheduleDueWork(ctx);
  ctx.logger.info('worker_schedule_only_completed');
}

async function runEnqueueSource(
  ctx: WorkerContext,
  sourceId: string | undefined,
): Promise<void> {
  if (!sourceId || !SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error('enqueue-source requires a valid source UUID');
  }

  await ctx.queue.start();
  const jobId = await ctx.queue.enqueue(
    'ingest-source',
    { sourceId },
    { singletonKey: sourceSingletonKey(sourceId) },
  );
  ctx.logger.info('source_enqueued', { sourceId, jobId });
}

async function runProcessArticles(
  ctx: WorkerContext,
  args: string[],
): Promise<void> {
  await ctx.queue.start();
  await processArticlesCommand(ctx, args);
}

function printUsage(): void {
  const logger: Logger = console;
  logger.info(
    [
      'Usage: openscroll-worker <command>',
      '',
      'Commands:',
      '  run              Enqueue due work, drain the queues, then exit (default)',
      '  watch            Stay alive, schedule due work every minute, and process jobs',
      '  schedule         Enqueue due source and retention jobs, then exit',
      '  enqueue-source   Enqueue one source by UUID',
      '  process-articles Enqueue pending/processing articles for processing',
      '    --limit N            Max articles to enqueue (default 20)',
      '    --status STATUS      Comma-separated: processing,pending (default both)',
      '    --dry-run            Show what would be enqueued without enqueueing',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
