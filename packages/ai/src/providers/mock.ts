import { createHash } from 'node:crypto';
import { normalizeVector } from '../vector';
import { estimateTokens } from '../http';
import type {
  EmbeddingOptions,
  EmbeddingProvider,
  EmbeddingResult,
  LlmGenerateOptions,
  LlmProvider,
  LlmResult,
} from '../types';

export interface MockLlmOptions {
  model?: string;
  response?: unknown | ((options: LlmGenerateOptions<unknown>) => unknown);
}

const defaultRelevance = {
  relevant: true,
  reason: 'Mock classifier: technology content',
};

const defaultCard = {
  hook: 'Why does idempotency make retries safe?',
  core_concept: Array.from(
    { length: 90 },
    (_, index) =>
      [
        'Idempotency',
        'ensures',
        'that',
        'repeating',
        'an',
        'operation',
        'has',
        'the',
        'same',
        'effect',
      ][index % 10],
  ).join(' '),
  key_takeaways: [
    'Retries are unavoidable in distributed systems',
    'Idempotency keys make duplicate work safe',
  ],
  topic_tags: ['distributed systems', 'reliability'],
  language: 'en',
};

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model: string;
  private readonly response:
    | unknown
    | ((options: LlmGenerateOptions<unknown>) => unknown);

  constructor(options: MockLlmOptions = {}) {
    this.model = options.model ?? 'mock-llm';
    this.response = options.response ?? defaultCard;
  }

  async generateObject<T>(
    options: LlmGenerateOptions<T>,
  ): Promise<LlmResult<T>> {
    const raw =
      typeof this.response === 'function'
        ? this.response(options as LlmGenerateOptions<unknown>)
        : this.response;
    let object: T;
    try {
      object = options.schema.parse(raw);
    } catch (error) {
      const fallback = options.schema.safeParse(defaultRelevance);
      if (!fallback.success) {
        throw error;
      }
      object = fallback.data;
    }
    const inputTokens = estimateTokens(options.system + options.prompt);
    const outputTokens = estimateTokens(JSON.stringify(object));

    return {
      object,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      provider: this.name,
      model: this.model,
    };
  }
}

export interface MockEmbeddingOptions {
  model?: string;
  dimensions?: number;
}

function seededVector(text: string, dimensions: number): number[] {
  const digest = createHash('sha256').update(text).digest();
  let state =
    ((digest[0] ?? 0) << 24) |
    ((digest[1] ?? 0) << 16) |
    ((digest[2] ?? 0) << 8) |
    (digest[3] ?? 1);

  const vector: number[] = [];
  for (let index = 0; index < dimensions; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const unsigned = state >>> 0;
    vector.push((unsigned / 0xffffffff) * 2 - 1);
  }
  return normalizeVector(vector);
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly model: string;
  readonly dimensions: number;

  constructor(options: MockEmbeddingOptions = {}) {
    this.model = options.model ?? 'mock-embedding';
    this.dimensions = options.dimensions ?? 1024;
  }

  async embed(
    texts: string[],
    _options: EmbeddingOptions = {},
  ): Promise<EmbeddingResult> {
    return {
      embeddings: texts.map((text) => seededVector(text, this.dimensions)),
      usage: {
        tokens: texts.reduce((sum, text) => sum + estimateTokens(text), 0),
      },
      provider: this.name,
      model: this.model,
      dimensions: this.dimensions,
    };
  }
}
