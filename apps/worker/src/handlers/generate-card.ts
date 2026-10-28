import { and, eq, isNotNull } from 'drizzle-orm';
import {
  classifyTechRelevance,
  generateMicroCard,
  PROMPT_VERSION,
} from '@openscroll/ai';
import { articles, cards } from '@openscroll/db';
import { PermanentJobError } from '@openscroll/queue';
import type { WorkerContext } from '../context';
import { truncateError } from '../transform';

export async function generateCard(
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
  if (article.status === 'skipped') {
    return;
  }

  const [existing] = await ctx.db
    .select({ id: cards.id })
    .from(cards)
    .where(
      and(
        eq(cards.articleId, article.id),
        eq(cards.promptVersion, PROMPT_VERSION),
        isNotNull(cards.embedding),
      ),
    )
    .limit(1);

  if (existing) {
    await markArticleReady(ctx, article.id, article.language);
    return;
  }

  if (!article.cleanedContent) {
    throw new Error(`Article ${article.id} has no cleaned content yet`);
  }

  try {
    const relevance = await classifyTechRelevance(
      { llm: ctx.llm },
      {
        title: article.title,
        content: article.cleanedContent,
        url: article.canonicalUrl,
      },
      { quota: ctx.quota, signal },
    );

    if (!relevance.relevant) {
      await markArticleFiltered(ctx, article.id, relevance.reason);
      ctx.logger.info('article_filtered', {
        articleId: article.id,
        title: article.title,
        reason: relevance.reason,
      });
      return;
    }

    const generated = await generateMicroCard(
      { llm: ctx.llm, embedding: ctx.embedding },
      {
        title: article.title,
        content: article.cleanedContent,
        language: article.language,
        url: article.canonicalUrl,
      },
      { quota: ctx.quota, signal },
    );

    const now = ctx.now();
    const [card] = await ctx.db
      .insert(cards)
      .values({
        articleId: article.id,
        hook: generated.hook,
        coreConcept: generated.core_concept,
        keyTakeaways: generated.key_takeaways,
        estimatedReadTimeSec: generated.estimatedReadTimeSec,
        embedding: generated.embedding,
        embeddingModel: generated.embeddingModel,
        embeddingDim: generated.embeddingDim,
        topicTags: generated.topic_tags,
        language: generated.language,
        generationModel: generated.generationModel,
        promptVersion: generated.promptVersion,
        status: 'published',
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [cards.articleId, cards.language, cards.promptVersion],
        set: {
          hook: generated.hook,
          coreConcept: generated.core_concept,
          keyTakeaways: generated.key_takeaways,
          estimatedReadTimeSec: generated.estimatedReadTimeSec,
          embedding: generated.embedding,
          embeddingModel: generated.embeddingModel,
          embeddingDim: generated.embeddingDim,
          topicTags: generated.topic_tags,
          generationModel: generated.generationModel,
          status: 'published',
          updatedAt: now,
        },
      })
      .returning({ id: cards.id });

    await markArticleReady(ctx, article.id, generated.language);

    ctx.logger.info('card_generated', {
      articleId: article.id,
      cardId: card?.id,
      llmTokens: generated.llmUsage.totalTokens,
      embeddingTokens: generated.embeddingUsage.tokens,
    });
  } catch (error) {
    ctx.logger.warn('card_generation_failed', {
      articleId: article.id,
      message: truncateError(error),
    });
    throw error;
  }
}

async function markArticleFiltered(
  ctx: WorkerContext,
  articleId: string,
  reason: string,
): Promise<void> {
  await ctx.db
    .update(articles)
    .set({
      status: 'skipped',
      lastError: truncateError(`Filtered: ${reason}`),
      updatedAt: ctx.now(),
    })
    .where(eq(articles.id, articleId));
}

async function markArticleReady(
  ctx: WorkerContext,
  articleId: string,
  language: string | null,
): Promise<void> {
  await ctx.db
    .update(articles)
    .set({
      status: 'ready',
      language,
      lastError: null,
      updatedAt: ctx.now(),
    })
    .where(eq(articles.id, articleId));
}
