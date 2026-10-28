import { and, eq, ne, sql } from 'drizzle-orm';
import { articles } from '@openscroll/db';
import { canonicalizeUrl, extractArticle } from '@openscroll/ingest';
import {
  PermanentJobError,
  articleSingletonKey,
} from '@openscroll/queue';
import type { WorkerContext } from '../context';
import { isObviouslyOffTopicTitle } from '../tech-relevance';
import {
  addDays,
  computeContentHash,
  truncateError,
} from '../transform';

const MAX_ARTICLE_BYTES = 5 * 1024 * 1024;
const ARTICLE_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'];
const MAX_TITLE_CHARS = 512;
const MAX_AUTHOR_CHARS = 255;
const MAX_LANGUAGE_CHARS = 16;

function clampMetadata(
  value: string | null | undefined,
  maxChars: number,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxChars);
}

export async function processArticle(
  ctx: WorkerContext,
  articleId: string,
  signal?: AbortSignal,
): Promise<void> {
  const [article] = await ctx.db
    .select()
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);

  if (!article) {
    throw new PermanentJobError(`Article ${articleId} does not exist`);
  }
  if (article.status === 'ready' || article.status === 'skipped') {
    return;
  }

  if (article.status === 'processing' && article.cleanedContent) {
    await enqueueCard(ctx, article.id);
    return;
  }

  const startedAt = ctx.now();
  await ctx.db
    .update(articles)
    .set({
      status: 'fetching',
      attempts: sql`${articles.attempts} + 1`,
      lastError: null,
      updatedAt: startedAt,
    })
    .where(eq(articles.id, article.id));

  let extracted;
  let rawContent: string;
  let finalUrl: string;

  try {
    const response = await ctx.fetchArticle(article.originalUrl, {
      timeoutMs: 10_000,
      maxBytes: MAX_ARTICLE_BYTES,
      maxRedirects: 3,
      allowedContentTypes: ARTICLE_CONTENT_TYPES,
      signal,
    });

    if (!response.ok) {
      throw new Error(`Article request failed with status ${response.status}`);
    }

    rawContent = response.text();
    finalUrl = response.url;
    extracted = extractArticle(rawContent, finalUrl);
    if (!extracted) {
      throw new Error('Could not extract readable article content');
    }
  } catch (error) {
    await markFailed(ctx, article.id, error);
    throw error;
  }

  const contentHash = computeContentHash(extracted.textContent);
  const [duplicate] = await ctx.db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.contentHash, contentHash),
        ne(articles.id, article.id),
      ),
    )
    .limit(1);

  if (duplicate) {
    const now = ctx.now();
    await ctx.db
      .update(articles)
      .set({
        status: 'skipped',
        contentHash,
        lastError: `Duplicate content of article ${duplicate.id}`,
        updatedAt: now,
      })
      .where(eq(articles.id, article.id));
    ctx.logger.info('article_duplicate', {
      articleId: article.id,
      duplicateOf: duplicate.id,
    });
    return;
  }

  let canonicalUrl = article.canonicalUrl;
  try {
    canonicalUrl = canonicalizeUrl(finalUrl);
  } catch {
    canonicalUrl = article.canonicalUrl;
  }

  const processedAt = ctx.now();
  const title =
    (extracted.title || article.title).trim().slice(0, MAX_TITLE_CHARS) ||
    'Untitled';
  const offTopic = isObviouslyOffTopicTitle(title);
  await ctx.db
    .update(articles)
    .set({
      title,
      originalUrl: article.originalUrl,
      canonicalUrl,
      rawContent,
      cleanedContent: extracted.textContent,
      contentHash,
      author:
        clampMetadata(extracted.byline, MAX_AUTHOR_CHARS) ??
        clampMetadata(article.author, MAX_AUTHOR_CHARS),
      language:
        clampMetadata(extracted.language, MAX_LANGUAGE_CHARS) ??
        clampMetadata(article.language, MAX_LANGUAGE_CHARS),
      status: offTopic ? 'skipped' : 'processing',
      lastError: offTopic ? 'Filtered: off-topic title' : null,
      retentionExpiresAt: addDays(
        processedAt,
        ctx.env.CLEANED_CONTENT_RETENTION_DAYS,
      ),
      updatedAt: processedAt,
    })
    .where(eq(articles.id, article.id));

  if (offTopic) {
    ctx.logger.info('article_filtered', {
      articleId: article.id,
      title,
      reason: 'off-topic title',
    });
    return;
  }

  await enqueueCard(ctx, article.id);
  ctx.logger.info('article_processed', {
    articleId: article.id,
    characters: extracted.textContent.length,
  });
}

async function enqueueCard(
  ctx: WorkerContext,
  articleId: string,
): Promise<void> {
  await ctx.queue.enqueue(
    'generate-card',
    { articleId },
    { singletonKey: articleSingletonKey(articleId) },
  );
}

async function markFailed(
  ctx: WorkerContext,
  articleId: string,
  error: unknown,
): Promise<void> {
  try {
    await ctx.db
      .update(articles)
      .set({
        status: 'failed',
        lastError: truncateError(error),
        updatedAt: ctx.now(),
      })
      .where(eq(articles.id, articleId));
  } catch (updateError) {
    ctx.logger.error('article_failure_update_failed', {
      articleId,
      message: truncateError(updateError),
    });
  }
  ctx.logger.warn('article_failed', {
    articleId,
    message: truncateError(error),
  });
}
