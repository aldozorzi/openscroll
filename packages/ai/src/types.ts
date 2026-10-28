import type { z } from 'zod';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LlmGenerateOptions<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface LlmResult<T> {
  object: T;
  usage: LlmUsage;
  provider: string;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateObject<T>(options: LlmGenerateOptions<T>): Promise<LlmResult<T>>;
}

export interface EmbeddingUsage {
  tokens: number;
}

export interface EmbeddingResult {
  embeddings: number[][];
  usage: EmbeddingUsage;
  provider: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingOptions {
  signal?: AbortSignal;
  batchSize?: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  embed(
    texts: string[],
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResult>;
}

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Response>;
