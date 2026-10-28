import { and, eq, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import { articles, cards } from '@openscroll/db';
import { articleSingletonKey } from '@openscroll/queue';
import type { WorkerContext } from './context';
import { truncateError } from './transform';

interface ProcessArticlesOptions {
  limit: number;
  statuses: Array<'pending' | 'processing'>;
  dryRun: boolean;
}

export async function processArticles(
  ctx: WorkerContext,
  options: ProcessArticlesOptions,
): Promise<void> {
  const { limit, statuses, dryRun } = options;

  // Subquery: articles that already have a published card with embedding
  const hasPublishedCard = ctx.db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.articleId, articles.id),
        eq(cards.status, 'published'),
        isNotNull(cards.embedding),
      )
    )
    .limit(1);

  // Select articles without a published card, ordered by processing first then createdAt
  const selected = await ctx.db
    .select({ id: articles.id, status: articles.status, title: articles.title })
    .from(articles)
    .where(
      and(
        inArray(articles.status, statuses),
        notExists(
          ctx.db
            .select({ id: cards.id })
            .from(cards)
            .where(
              and(
                eq(cards.articleId, articles.id),
                eq(cards.status, 'published'),
                isNotNull(cards.embedding),
              )
            )
            .limit(1),
        ),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${articles.status} = 'processing' THEN 0 ELSE 1 END`,
      articles.createdAt,
    )
    .limit(limit);

  ctx.logger.info('process_articles_selected', {
    processing: selected.filter((r) => r.status === 'processing').length,
    pending: selected.filter((r) => r.status === 'pending').length,
    total: selected.length,
    limit,
  });

  if (dryRun) {
    for (const article of selected) {
      ctx.logger.info('article_would_enqueue', { articleId: article.id, status: article.status, title: article.title });
    }
    return;
  }

  let enqueued = 0;
  for (const article of selected) {
    try {
      const jobId = await ctx.queue.enqueue(
        'process-article',
        { articleId: article.id },
        { singletonKey: articleSingletonKey(article.id) },
      );
      if (jobId) {
        enqueued++;
        ctx.logger.info('article_enqueued', { articleId: article.id, status: article.status });
      }
    } catch (error) {
      ctx.logger.warn('article_enqueue_failed', {
        articleId: article.id,
        message: truncateError(error),
      });
    }
  }

  ctx.logger.info('process_articles_enqueued', { enqueued, total: selected.length });
}

export async function processArticlesCommand(ctx: WorkerContext, args: string[]): Promise<void> {
  // Parse args: --limit N --status processing,pending --dry-run
  let limit = 20;
  let statuses: Array<'pending' | 'processing'> = ['pending', 'processing'];
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit') {
      limit = Number(args[++i]);
    } else if (arg === '--status') {
      const val = args[++i];
      if (!val) {
        throw new Error('--status requires a value');
      }
      statuses = val.split(',') as Array<'pending' | 'processing'>;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  await processArticles(ctx, { limit, statuses, dryRun });
}