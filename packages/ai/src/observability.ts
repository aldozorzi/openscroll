import type {
  EmbeddingProvider,
  EmbeddingResult,
  LlmGenerateOptions,
  LlmProvider,
  LlmResult,
} from './types';

export interface ProviderObservation {
  event: 'provider_call';
  operation: 'llm.generate' | 'embedding.create';
  provider: string;
  model: string;
  latencyMs: number;
  outcome: 'success' | 'error';
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  embeddingCount?: number;
  dimensions?: number;
  errorName?: string;
}

export type ProviderObserver = (observation: ProviderObservation) => void;

export interface AiProviders {
  llm: LlmProvider;
  embedding: EmbeddingProvider;
}

function observe<T>(
  observer: ProviderObserver,
  operation: ProviderObservation['operation'],
  provider: string,
  model: string,
  startedAt: number,
  outcome: 'success' | 'error',
  details: Partial<
    Pick<
      ProviderObservation,
      | 'inputTokens'
      | 'outputTokens'
      | 'totalTokens'
      | 'embeddingCount'
      | 'dimensions'
      | 'errorName'
    >
  >,
): void {
  observer({
    event: 'provider_call',
    operation,
    provider,
    model,
    latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    outcome,
    ...details,
  });
}

export function instrumentProviders(
  providers: AiProviders,
  observer: ProviderObserver,
): AiProviders {
  const llm: LlmProvider = {
    name: providers.llm.name,
    model: providers.llm.model,
    async generateObject<T>(options: LlmGenerateOptions<T>): Promise<LlmResult<T>> {
      const startedAt = performance.now();
      try {
        const result = await providers.llm.generateObject(options);
        observe(
          observer,
          'llm.generate',
          result.provider,
          result.model,
          startedAt,
          'success',
          {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            totalTokens: result.usage.totalTokens,
          },
        );
        return result;
      } catch (error) {
        observe(
          observer,
          'llm.generate',
          providers.llm.name,
          providers.llm.model,
          startedAt,
          'error',
          { errorName: error instanceof Error ? error.name : 'Error' },
        );
        throw error;
      }
    },
  };

  const embedding: EmbeddingProvider = {
    name: providers.embedding.name,
    model: providers.embedding.model,
    dimensions: providers.embedding.dimensions,
    async embed(texts, options): Promise<EmbeddingResult> {
      const startedAt = performance.now();
      try {
        const result = await providers.embedding.embed(texts, options);
        observe(
          observer,
          'embedding.create',
          result.provider,
          result.model,
          startedAt,
          'success',
          {
            totalTokens: result.usage.tokens,
            embeddingCount: result.embeddings.length,
            dimensions: result.dimensions,
          },
        );
        return result;
      } catch (error) {
        observe(
          observer,
          'embedding.create',
          providers.embedding.name,
          providers.embedding.model,
          startedAt,
          'error',
          { errorName: error instanceof Error ? error.name : 'Error' },
        );
        throw error;
      }
    },
  };

  return { llm, embedding };
}
