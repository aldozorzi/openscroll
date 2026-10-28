import { eq } from 'drizzle-orm';
import { articles, sources } from '@openscroll/db';
import {
  PermanentJobError,
  articleSingletonKey,
} from '@openscroll/queue';
import type { WorkerContext } from '../context';
import { recordSourceFailure } from '../source-health';
import {
  articleInsertFromFeedItem,
  isArticlePending,
  nextFetchAt,
  scopeArticleUrlHash,
} from '../transform';

export async function ingestSource(
  ctx: WorkerContext,
  sourceId: string,
): Promise<void> {
  const [source] = await ctx.db
    .select()
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);

  if (!source) {
    throw new PermanentJobError(`Source ${sourceId} does not exist`);
  }
  if (!source.isActive) {
    ctx.logger.info('source_skipped', { sourceId, reason: 'inactive' });
    return;
  }

  const fetchedAt = ctx.now();
  let feedResult;
  try {
    feedResult = await ctx.fetchFeed(source.url, {
      etag: source.etag,
      lastModified: source.lastModified,
    });
  } catch (error) {
    await recordSourceFailure(ctx, source, error, fetchedAt);
    throw error;
  }

  await ctx.db
    .update(sources)
    .set({
      etag: feedResult.etag,
      lastModified: feedResult.lastModified,
      lastFetchedAt: fetchedAt,
      nextFetchAt: nextFetchAt(fetchedAt, source.fetchIntervalMinutes),
      consecutiveFailures: 0,
      lastError: null,
      updatedAt: fetchedAt,
    })
    .where(eq(sources.id, source.id));

  if (feedResult.notModified || !feedResult.feed) {
    ctx.logger.info('source_not_modified', { sourceId: source.id });
    return;
  }

  let inserted = 0;
  let requeued = 0;

  for (const item of feedResult.feed.items) {

    const insertedValues = articleInsertFromFeedItem(
      item,
      source.id,
      fetchedAt,
      ctx.env.CLEANED_CONTENT_RETENTION_DAYS,
    );
    if (!insertedValues) {
      continue;
    }
    const values = {
      ...insertedValues,
      author: item.author,
      language: feedResult.feed.language,
      urlHash: scopeArticleUrlHash(insertedValues.urlHash, source),
    };

    const [existing] = await ctx.db
      .select({ id: articles.id, status: articles.status })
      .from(articles)
      .where(eq(articles.urlHash, values.urlHash))
      .limit(1);

    if (existing) {
      if (isArticlePending(existing.status)) {
        await ctx.queue.enqueue(
          'process-article',
          { articleId: existing.id },
          { singletonKey: articleSingletonKey(existing.id) },
        );
        requeued += 1;
      }
      continue;
    }

    const [created] = await ctx.db
      .insert(articles)
      .values(values)
      .onConflictDoNothing({ target: articles.urlHash })
      .returning({ id: articles.id });

    if (created) {
      await ctx.queue.enqueue(
        'process-article',
        { articleId: created.id },
        { singletonKey: articleSingletonKey(created.id) },
      );
      inserted += 1;
      continue;
    }

    const [conflict] = await ctx.db
      .select({ id: articles.id, status: articles.status })
      .from(articles)
      .where(eq(articles.urlHash, values.urlHash))
      .limit(1);

    if (conflict && isArticlePending(conflict.status)) {
      await ctx.queue.enqueue(
        'process-article',
        { articleId: conflict.id },
        { singletonKey: articleSingletonKey(conflict.id) },
      );
      requeued += 1;
    }
  }

  ctx.logger.info('source_ingested', {
    sourceId: source.id,
    feedItems: feedResult.feed.items.length,
    inserted,
    requeued,
  });
}
