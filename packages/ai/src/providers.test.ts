import { describe, expect, it, vi } from 'vitest';
import { MicroCardSchema } from '@openscroll/contracts';
import { ProviderConfigError, ProviderHttpError } from './errors';
import {
  CloudflareEmbeddingProvider,
  CloudflareLlmProvider,
} from './providers/cloudflare';
import { GoogleLlmProvider } from './providers/google';
import { OpenAiCompatibleLlmProvider } from './providers/openai-compatible';
import type { FetchLike } from './types';

const card = {
  hook: 'Why does idempotency make retries safe?',
  core_concept: Array.from({ length: 90 }, (_, index) => `word${index}`).join(
    ' ',
  ),
  key_takeaways: ['Retries are inevitable', 'Duplicate work must be safe'],
  topic_tags: ['distributed systems'],
  language: 'en',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GoogleLlmProvider', () => {
  it('parses structured output and token usage', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(card) }] } },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 200,
          totalTokenCount: 300,
        },
      });

    const provider = new GoogleLlmProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash-lite',
      fetchImpl,
    });

    const result = await provider.generateObject({
      system: 'system',
      prompt: 'prompt',
      schema: MicroCardSchema,
    });

    expect(result.object.hook).toBe(card.hook);
    expect(result.usage.totalTokens).toBe(300);
    expect(result.provider).toBe('google');
  });

  it('requires an API key', () => {
    expect(
      () => new GoogleLlmProvider({ apiKey: '', model: 'gemini' }),
    ).toThrow(ProviderConfigError);
  });

  it('surfaces rate limits without retrying credentials failures', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'unauthorized' }, 401),
    );

    const provider = new GoogleLlmProvider({
      apiKey: 'test-key',
      model: 'gemini',
      fetchImpl,
      maxRetries: 2,
    });

    await expect(
      provider.generateObject({
        system: 'system',
        prompt: 'prompt',
        schema: MicroCardSchema,
      }),
    ).rejects.toBeInstanceOf(ProviderHttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Cloudflare providers', () => {
  it('parses Cloudflare chat responses', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        success: true,
        result: { response: JSON.stringify(card) },
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

    const provider = new CloudflareLlmProvider({
      accountId: 'account',
      apiToken: 'token',
      model: '@cf/meta/llama-3.1-8b-instruct',
      fetchImpl,
    });

    const result = await provider.generateObject({
      system: 'system',
      prompt: 'prompt',
      schema: MicroCardSchema,
    });

    expect(result.object.topic_tags).toEqual(card.topic_tags);
    expect(result.usage.totalTokens).toBe(30);
  });

  it('normalizes Cloudflare embeddings', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        success: true,
        result: { shape: [1, 4], data: [[1, 2, 3, 4]] },
      }),
    );

    const provider = new CloudflareEmbeddingProvider({
      accountId: 'account',
      apiToken: 'token',
      model: '@cf/baai/bge-m3',
      dimensions: 4,
      fetchImpl,
    });

    const result = await provider.embed(['hello']);
    expect(result.embeddings[0]).toHaveLength(4);
    const norm = Math.sqrt(
      (result.embeddings[0] ?? []).reduce(
        (sum, value) => sum + value * value,
        0,
      ),
    );
    expect(norm).toBeCloseTo(1, 5);
    expect(result.usage.tokens).toBeGreaterThan(0);

    const body = JSON.parse(
      fetchImpl.mock.calls[0]?.[1].body as string,
    ) as { text: string[] };
    expect(body.text).toEqual(['hello']);
  });

  it('requires Cloudflare credentials', () => {
    expect(
      () =>
        new CloudflareEmbeddingProvider({
          accountId: '',
          apiToken: '',
          model: '@cf/baai/bge-m3',
        }),
    ).toThrow(ProviderConfigError);
  });
});

describe('OpenAiCompatibleLlmProvider', () => {
  it('parses OpenAI-compatible chat responses', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        choices: [{ message: { content: JSON.stringify(card) } }],
        usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
      });

    const provider = new OpenAiCompatibleLlmProvider({
      baseUrl: 'https://example.com/v1',
      apiKey: 'key',
      model: 'model',
      fetchImpl,
    });

    const result = await provider.generateObject({
      system: 'system',
      prompt: 'prompt',
      schema: MicroCardSchema,
    });

    expect(result.usage.totalTokens).toBe(12);
    expect(result.provider).toBe('openai-compatible');
  });
});
