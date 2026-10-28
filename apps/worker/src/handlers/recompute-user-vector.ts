import { and, asc, desc, eq, gt, isNotNull } from 'drizzle-orm';
import {
  estimateTokens,
  normalizeVector,
  type EmbeddingResult,
} from '@openscroll/ai';
import {
  INTERACTION_TYPES,
  type InteractionType,
} from '@openscroll/contracts';
import {
  cards,
  userInteractions,
  userPreferences,
  users,
} from '@openscroll/db';
import { PermanentJobError } from '@openscroll/queue';
import {
  applyInteraction,
  interactionAlpha,
  meanVector,
} from '@openscroll/recommendation';
import type { WorkerContext } from '../context';

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERACTION_WINDOW_DAYS = 90;
const RECENT_CARD_LIMIT = 20;

function isInteractionType(value: string): value is InteractionType {
  return (INTERACTION_TYPES as readonly string[]).includes(value);
}

function validEmbedding(embedding: number[] | null, dimensions: number): embedding is number[] {
  return (
    embedding !== null &&
    embedding.length === dimensions &&
    embedding.every((value) => Number.isFinite(value))
  );
}

async function embedTopics(
  ctx: WorkerContext,
  topics: string[],
  signal?: AbortSignal,
): Promise<number[]> {
  const text = topics.join('\n');
  const reservation = await ctx.quota.reserveEmbedding(
    ctx.embedding.name,
    estimateTokens(text),
  );

  let result: EmbeddingResult;
  try {
    result = await ctx.embedding.embed(topics, { signal });
  } catch (error) {
    await reservation.release();
    throw error;
  }
  await reservation.settle(result.usage.tokens);

  if (result.embeddings.length !== topics.length) {
    throw new Error(
      `Embedding provider returned ${result.embeddings.length} vectors for ${topics.length} topics`,
    );
  }

  const normalized = result.embeddings.map((embedding) => {
    if (embedding.length !== ctx.embedding.dimensions) {
      throw new Error(
        `Topic embedding has ${embedding.length} dimensions, expected ${ctx.embedding.dimensions}`,
      );
    }
    return normalizeVector(embedding);
  });

  return meanVector(normalized);
}

export async function recomputeUserVector(
  ctx: WorkerContext,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  const [user] = await ctx.db
    .select({
      id: users.id,
      userVector: users.userVector,
      userVectorUpdatedAt: users.userVectorUpdatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new PermanentJobError(`User ${userId} does not exist`);
  }

  const [preferences] = await ctx.db
    .select({
      topics: userPreferences.topics,
      updatedAt: userPreferences.updatedAt,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  const topics = [...new Set((preferences?.topics ?? []).map((topic) => topic.trim()))].filter(
    (topic) => topic.length > 0,
  );
  const now = ctx.now();
  const dimensions = ctx.embedding.dimensions;
  const existingVector = validEmbedding(user.userVector, dimensions)
    ? user.userVector
    : null;

  const topicsChanged =
    topics.length > 0 &&
    (!existingVector ||
      !user.userVectorUpdatedAt ||
      (preferences?.updatedAt.getTime() ?? 0) > user.userVectorUpdatedAt.getTime());

  let vector = topicsChanged
    ? await embedTopics(ctx, topics, signal)
    : existingVector;

  const since = topicsChanged
    ? new Date(now.getTime() - INTERACTION_WINDOW_DAYS * DAY_MS)
    : (user.userVectorUpdatedAt ??
      new Date(now.getTime() - INTERACTION_WINDOW_DAYS * DAY_MS));

  const interactions = await ctx.db
    .select({
      interactionType: userInteractions.interactionType,
      dwellTimeMs: userInteractions.dwellTimeMs,
      embedding: cards.embedding,
    })
    .from(userInteractions)
    .innerJoin(cards, eq(userInteractions.cardId, cards.id))
    .where(
      and(
        eq(userInteractions.userId, userId),
        gt(userInteractions.createdAt, since),
      ),
    )
    .orderBy(asc(userInteractions.createdAt));

  let appliedInteractions = 0;
  for (const interaction of interactions) {
    if (!isInteractionType(interaction.interactionType)) {
      continue;
    }
    if (!validEmbedding(interaction.embedding, dimensions)) {
      continue;
    }

    const alpha = interactionAlpha(
      interaction.interactionType,
      interaction.dwellTimeMs,
    );
    vector = applyInteraction(vector, interaction.embedding, alpha);
    if (alpha !== 0) {
      appliedInteractions += 1;
    }
  }

  if (!vector) {
    const recentCards = await ctx.db
      .select({ embedding: cards.embedding })
      .from(cards)
      .where(and(eq(cards.status, 'published'), isNotNull(cards.embedding)))
      .orderBy(desc(cards.createdAt))
      .limit(RECENT_CARD_LIMIT);

    const embeddings = recentCards
      .map((card) => card.embedding)
      .filter((embedding): embedding is number[] => validEmbedding(embedding, dimensions));

    if (embeddings.length > 0) {
      vector = meanVector(embeddings);
    }
  }

  const normalized = vector ? normalizeVector(vector) : null;

  await ctx.db
    .update(users)
    .set({
      userVector: normalized,
      userVectorUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  ctx.logger.info('user_vector_recomputed', {
    userId,
    topics: topics.length,
    interactions: appliedInteractions,
    hasVector: normalized !== null,
  });
}
