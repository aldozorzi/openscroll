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

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z.array(z.object({ text: z.string().optional() })).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      totalTokenCount: z.number().optional(),
    })
    .optional(),
});

export interface GoogleLlmProviderOptions {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

export class GoogleLlmProvider implements LlmProvider {
  readonly name = 'google';
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: GoogleLlmProviderOptions) {
    if (!options.apiKey) {
      throw new ProviderConfigError('GOOGLE_GENERATIVE_AI_API_KEY is required');
    }
    if (!options.model) {
      throw new ProviderConfigError('LLM_MODEL is required for Google');
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async generateObject<T>(
    options: LlmGenerateOptions<T>,
  ): Promise<LlmResult<T>> {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      `${encodeURIComponent(this.model)}:generateContent?key=` +
      encodeURIComponent(this.apiKey);

    const response = await postJson<unknown>(
      url,
      {
        systemInstruction: {
          parts: [{ text: options.system }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: options.prompt }],
          },
        ],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 2_048,
          responseMimeType: 'application/json',
        },
      },
      {
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        signal: options.signal,
        fetchImpl: this.fetchImpl,
      },
    );

    const parsed = GeminiResponseSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new ProviderResponseError('Unexpected Google response shape');
    }

    const text = (parsed.data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      throw new ProviderResponseError('Google returned an empty response');
    }

    let json: unknown;
    try {
      json = parseJsonObject(text);
    } catch (error) {
      throw new ProviderResponseError('Google returned invalid JSON content', {
        cause: error,
      });
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
      parsed.data.usageMetadata?.promptTokenCount ??
      estimateTokens(options.system + options.prompt);
    const outputTokens =
      parsed.data.usageMetadata?.candidatesTokenCount ??
      estimateTokens(text);

    return {
      object: validated.data,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          parsed.data.usageMetadata?.totalTokenCount ??
          inputTokens + outputTokens,
      },
      provider: this.name,
      model: this.model,
    };
  }
}
