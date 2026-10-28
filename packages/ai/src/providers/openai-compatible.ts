import { z } from 'zod';
import { ProviderConfigError, ProviderResponseError } from '../errors';
import { estimateTokens, postJson } from '../http';
import { parseJsonObject } from '../json';
import type {
  FetchLike,
  LlmGenerateOptions,
  LlmProvider,
  LlmResult,
} from '../types';

const ChatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional(), reasoning: z.string().nullable().optional() }),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export interface OpenAiCompatibleProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  name?: string;
  jsonMode?: boolean;
  extraHeaders?: Record<string, string>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly jsonMode: boolean;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: OpenAiCompatibleProviderOptions) {
    if (!options.baseUrl || !options.apiKey || !options.model) {
      throw new ProviderConfigError(
        'OpenAI-compatible provider requires baseUrl, apiKey, and model',
      );
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.name = options.name ?? 'openai-compatible';
    this.jsonMode = options.jsonMode ?? true;
    this.extraHeaders = options.extraHeaders ?? {};
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async generateObject<T>(
    options: LlmGenerateOptions<T>,
  ): Promise<LlmResult<T>> {
    const response = await postJson<unknown>(
      `${this.baseUrl}/chat/completions`,
      {
        model: this.model,
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.prompt },
        ],
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxOutputTokens ?? 2_048,
        ...(this.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        signal: options.signal,
        fetchImpl: this.fetchImpl,
      },
    );

    const parsed = ChatResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new ProviderResponseError(
        'Unexpected OpenAI-compatible response shape',
      );
    }

    const message = parsed.data.choices?.[0]?.message;
    const text = message?.content?.trim() ?? message?.reasoning?.trim() ?? '';
    if (!text) {
      throw new ProviderResponseError('Provider returned an empty response');
    }

    const json = parseJsonObject(text);
    const validated = options.schema.safeParse(json);
    if (!validated.success) {
      throw new ProviderResponseError(
        `Card schema validation failed: ${validated.error.issues
          .map((issue) => issue.message)
          .join('; ')}`,
      );
    }

    const inputTokens =
      parsed.data.usage?.prompt_tokens ??
      estimateTokens(options.system + options.prompt);
    const outputTokens =
      parsed.data.usage?.completion_tokens ?? estimateTokens(text);

    return {
      object: validated.data,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          parsed.data.usage?.total_tokens ?? inputTokens + outputTokens,
      },
      provider: this.name,
      model: this.model,
    };
  }
}
