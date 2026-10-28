import {
  MicroCardSchema,
  estimateReadTimeSec,
  type MicroCard,
} from '@openscroll/contracts';
import { AiError } from './errors';
import { estimateTokens } from './http';
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildCardPrompt,
  type CardPromptInput,
} from './prompt';
import type {
  EmbeddingProvider,
  EmbeddingUsage,
  LlmProvider,
  LlmUsage,
} from './types';
import type { QuotaGuard } from './usage';
import { normalizeVector } from './vector';

export interface GenerateCardDependencies {
  llm: LlmProvider;
  embedding: EmbeddingProvider;
}

export interface GenerateCardOptions {
  quota?: QuotaGuard;
  signal?: AbortSignal;
  maxOutputTokens?: number;
}

export interface GeneratedCard extends MicroCard {
  estimatedReadTimeSec: number;
  embedding: number[];
  embeddingModel: string;
  embeddingDim: number;
  generationModel: string;
  promptVersion: string;
  llmUsage: LlmUsage;
  embeddingUsage: EmbeddingUsage;
}

export async function generateMicroCard(
  dependencies: GenerateCardDependencies,
  article: CardPromptInput,
  options: GenerateCardOptions = {},
): Promise<GeneratedCard> {
  const prompt = buildCardPrompt(article);
  const maxOutputTokens = options.maxOutputTokens ?? 2_048;
  const llmEstimate =
    estimateTokens(SYSTEM_PROMPT + prompt) + maxOutputTokens;

  const llmReservation = options.quota
    ? await options.quota.reserveLlm(dependencies.llm.name, llmEstimate)
    : null;

  let llmResult;
  try {
    llmResult = await dependencies.llm.generateObject({
      system: SYSTEM_PROMPT,
      prompt,
      schema: MicroCardSchema,
      maxOutputTokens,
      signal: options.signal,
    });
  } catch (error) {
    await llmReservation?.release();
    throw error;
  }

  await llmReservation?.settle(llmResult.usage.totalTokens);

  const embeddingText = `${llmResult.object.hook}\n${llmResult.object.core_concept}`;
  const embeddingEstimate = estimateTokens(embeddingText);
  const embeddingReservation = options.quota
    ? await options.quota.reserveEmbedding(
        dependencies.embedding.name,
        embeddingEstimate,
      )
    : null;

  let embeddingResult;
  try {
    embeddingResult = await dependencies.embedding.embed([embeddingText], {
      signal: options.signal,
    });
  } catch (error) {
    await embeddingReservation?.release();
    throw error;
  }

  await embeddingReservation?.settle(embeddingResult.usage.tokens);

  const embedding = embeddingResult.embeddings[0];
  if (!embedding) {
    throw new AiError('Embedding provider returned no vector', 'NO_EMBEDDING');
  }
  if (embedding.length !== dependencies.embedding.dimensions) {
    throw new AiError(
      `Embedding has ${embedding.length} dimensions, expected ${dependencies.embedding.dimensions}`,
      'INVALID_EMBEDDING',
    );
  }

  return {
    ...llmResult.object,
    estimatedReadTimeSec: estimateReadTimeSec(llmResult.object),
    embedding: normalizeVector(embedding),
    embeddingModel: embeddingResult.model,
    embeddingDim: embeddingResult.dimensions,
    generationModel: llmResult.model,
    promptVersion: PROMPT_VERSION,
    llmUsage: llmResult.usage,
    embeddingUsage: embeddingResult.usage,
  };
}
