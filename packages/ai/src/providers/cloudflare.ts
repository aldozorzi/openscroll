import { z } from 'zod';
import { normalizeVector } from '../vector';
import { ProviderConfigError, ProviderResponseError } from '../errors';
import { estimateTokens, postJson } from '../http';
import { parseJsonObject } from '../json';
import type {
  EmbeddingOptions,
  EmbeddingProvider,
  EmbeddingResult,
  FetchLike,
  LlmGenerateOptions,
  LlmProvider,
  LlmResult,
} from '../types';

const CloudflareEnvelopeSchema = z.object({
  success: z.boolean().optional(),
  errors: z
    .array(z.object({ message: z.string().optional() }))
    .optional(),
  result: z.unknown(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export interface CloudflareOptions {
  accountId: string;
  apiToken: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_LLM_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3';

function cloudflareUrl(accountId: string, model: string): string {
  return (
    `https://api.cloudflare.com/client/v4/accounts/${accountId}` +
    `/ai/run/${model}`
  );
}

function assertEnvelope(
  data: unknown,
): z.infer<typeof CloudflareEnvelopeSchema> {
  const parsed = CloudflareEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new ProviderResponseError('Unexpected Cloudflare response shape');
  }
  if (parsed.data.success === false) {
    const message =
      parsed.data.errors?.[0]?.message ?? 'Cloudflare request failed';
    throw new ProviderResponseError(message);
  }
  return parsed.data;
}

function extractLlmContent(result: unknown): {
  text: string | null;
  object: unknown;
} {
  if (typeof result === 'string') {
    return { text: result, object: null };
  }
  if (!result || typeof result !== 'object') {
    return { text: null, object: null };
  }

  const record = result as Record<string, unknown>;
  if (typeof record.response === 'string') {
    return { text: record.response, object: null };
  }
  if (record.response && typeof record.response === 'object') {
    return { text: null, object: record.response };
  }
  if (Array.isArray(record.choices)) {
    const first = record.choices[0] as
      | { message?: { content?: string } }
      | undefined;
    if (typeof first?.message?.content === 'string') {
      return { text: first.message.content, object: null };
    }
  }
  if (typeof record.content === 'string') {
    return { text: record.content, object: null };
  }

  return { text: null, object: null };
}

export class CloudflareLlmProvider implements LlmProvider {
  readonly name = 'cloudflare';
  readonly model: string;
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: CloudflareOptions) {
    if (!options.accountId || !options.apiToken) {
      throw new ProviderConfigError(
        'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required',
      );
    }
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.model = options.model || DEFAULT_LLM_MODEL;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async generateObject<T>(
    options: LlmGenerateOptions<T>,
  ): Promise<LlmResult<T>> {
    const response = await postJson<unknown>(
      cloudflareUrl(this.accountId, this.model),
      {
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.prompt },
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxOutputTokens ?? 2_048,
        response_format: { type: 'json_object' },
      },
      {
        headers: { authorization: `Bearer ${this.apiToken}` },
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        signal: options.signal,
        fetchImpl: this.fetchImpl,
      },
    );

    const envelope = assertEnvelope(response.data);
    const content = extractLlmContent(envelope.result);

    let json = content.object;
    if (json === null) {
      if (!content.text) {
        throw new ProviderResponseError('Cloudflare returned an empty response');
      }
      json = parseJsonObject(content.text);
    }

    const validated = options.schema.safeParse(json);
    if (!validated.success) {
      throw new ProviderResponseError(
        `Card schema validation failed: ${validated.error.issues
          .map((issue) => issue.message)
          .join('; ')}`,
      );
    }

    const inputTokens =
      envelope.usage?.prompt_tokens ??
      estimateTokens(options.system + options.prompt);
    const outputTokens =
      envelope.usage?.completion_tokens ??
      estimateTokens(content.text ?? JSON.stringify(json));

    return {
      object: validated.data,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          envelope.usage?.total_tokens ?? inputTokens + outputTokens,
      },
      provider: this.name,
      model: this.model,
    };
  }
}

const EmbeddingEnvelopeSchema = z.object({
  success: z.boolean().optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
  result: z.object({
    shape: z.array(z.number()).optional(),
    data: z.array(z.array(z.number())),
  }),
});

export interface CloudflareEmbeddingOptions extends CloudflareOptions {
  dimensions?: number;
  batchSize?: number;
}

export class CloudflareEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'cloudflare';
  readonly model: string;
  readonly dimensions: number;
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly batchSize: number;

  constructor(options: CloudflareEmbeddingOptions) {
    if (!options.accountId || !options.apiToken) {
      throw new ProviderConfigError(
        'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required',
      );
    }
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.model = options.model || DEFAULT_EMBEDDING_MODEL;
    this.dimensions = options.dimensions ?? 1024;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.batchSize = options.batchSize ?? 50;
  }

  async embed(
    texts: string[],
    options: EmbeddingOptions = {},
  ): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return {
        embeddings: [],
        usage: { tokens: 0 },
        provider: this.name,
        model: this.model,
        dimensions: this.dimensions,
      };
    }

    const batchSize = options.batchSize ?? this.batchSize;
    const embeddings: number[][] = [];
    let tokens = 0;

    for (let index = 0; index < texts.length; index += batchSize) {
      const batch = texts.slice(index, index + batchSize);
      const response = await postJson<unknown>(
        cloudflareUrl(this.accountId, this.model),
        { text: batch },
        {
          headers: { authorization: `Bearer ${this.apiToken}` },
          timeoutMs: this.timeoutMs,
          maxRetries: this.maxRetries,
          signal: options.signal,
          fetchImpl: this.fetchImpl,
        },
      );

      const parsed = EmbeddingEnvelopeSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new ProviderResponseError(
          'Unexpected Cloudflare embedding response',
        );
      }
      if (parsed.data.success === false) {
        throw new ProviderResponseError(
          parsed.data.errors?.[0]?.message ??
            'Cloudflare embedding request failed',
        );
      }

      for (const vector of parsed.data.result.data) {
        if (vector.length !== this.dimensions) {
          throw new ProviderResponseError(
            `Embedding has ${vector.length} dimensions, expected ${this.dimensions}`,
          );
        }
        embeddings.push(normalizeVector(vector));
      }

      tokens += batch.reduce((sum, text) => sum + estimateTokens(text), 0);
    }

    return {
      embeddings,
      usage: { tokens },
      provider: this.name,
      model: this.model,
      dimensions: this.dimensions,
    };
  }
}
