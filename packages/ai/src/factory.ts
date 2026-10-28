import type { Pool } from 'pg';
import { ProviderConfigError } from './errors';
import {
  CloudflareEmbeddingProvider,
  CloudflareLlmProvider,
} from './providers/cloudflare';
import { GoogleLlmProvider } from './providers/google';
import {
  MockEmbeddingProvider,
  MockLlmProvider,
} from './providers/mock';
import { OpenAiCompatibleLlmProvider } from './providers/openai-compatible';
import type { EmbeddingProvider, FetchLike, LlmProvider } from './types';
import {
  PostgresUsageTracker,
  QuotaGuard,
  type UsageLimits,
  type UsageTracker,
} from './usage';

export interface AiEnv {
  LLM_PROVIDER: 'google' | 'cloudflare' | 'openrouter' | 'mock';
  LLM_MODEL: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_APP_URL?: string;
  OPENROUTER_APP_NAME?: string;
  EMBEDDING_PROVIDER: 'cloudflare' | 'mock';
  EMBEDDING_MODEL: string;
  EMBEDDING_DIM: number;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  MAX_LLM_TOKENS_PER_DAY: number;
  MAX_EMBEDDING_TOKENS_PER_DAY: number;
}

export interface AiProviderSet {
  llm: LlmProvider;
  embedding: EmbeddingProvider;
}

export interface CreateAiProvidersOptions {
  fetchImpl?: FetchLike;
}

export function createAiProviders(
  env: AiEnv,
  options: CreateAiProvidersOptions = {},
): AiProviderSet {
  const llm = createLlmProvider(env, options);
  const embedding = createEmbeddingProvider(env, options);
  return { llm, embedding };
}

function createLlmProvider(
  env: AiEnv,
  options: CreateAiProvidersOptions,
): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'google':
      return new GoogleLlmProvider({
        apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
        model: env.LLM_MODEL,
        fetchImpl: options.fetchImpl,
      });
    case 'cloudflare':
      return new CloudflareLlmProvider({
        accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
        apiToken: env.CLOUDFLARE_API_TOKEN ?? '',
        model: env.LLM_MODEL,
        fetchImpl: options.fetchImpl,
      });
    case 'openrouter': {
      const apiKey = env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) {
        throw new ProviderConfigError(
          'OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter',
        );
      }
      const extraHeaders: Record<string, string> = {};
      if (env.OPENROUTER_APP_URL) {
        extraHeaders['HTTP-Referer'] = env.OPENROUTER_APP_URL;
      }
      if (env.OPENROUTER_APP_NAME) {
        extraHeaders['X-Title'] = env.OPENROUTER_APP_NAME;
      }
      return new OpenAiCompatibleLlmProvider({
        baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
        apiKey,
        model: env.LLM_MODEL,
        name: 'openrouter',
        extraHeaders,
        fetchImpl: options.fetchImpl,
        timeoutMs: 90_000,
      });
    }
    case 'mock':
      return new MockLlmProvider({ model: env.LLM_MODEL || 'mock-llm' });
    default:
      throw new ProviderConfigError(
        `Unsupported LLM_PROVIDER: ${String(env.LLM_PROVIDER)}`,
      );
  }
}

function createEmbeddingProvider(
  env: AiEnv,
  options: CreateAiProvidersOptions,
): EmbeddingProvider {
  switch (env.EMBEDDING_PROVIDER) {
    case 'cloudflare':
      return new CloudflareEmbeddingProvider({
        accountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
        apiToken: env.CLOUDFLARE_API_TOKEN ?? '',
        model: env.EMBEDDING_MODEL,
        dimensions: env.EMBEDDING_DIM,
        fetchImpl: options.fetchImpl,
      });
    case 'mock':
      return new MockEmbeddingProvider({
        model: env.EMBEDDING_MODEL || 'mock-embedding',
        dimensions: env.EMBEDDING_DIM,
      });
    default:
      throw new ProviderConfigError(
        `Unsupported EMBEDDING_PROVIDER: ${String(env.EMBEDDING_PROVIDER)}`,
      );
  }
}

export function usageLimitsFromEnv(env: AiEnv): UsageLimits {
  return {
    llmTokensPerDay: env.MAX_LLM_TOKENS_PER_DAY,
    embeddingTokensPerDay: env.MAX_EMBEDDING_TOKENS_PER_DAY,
  };
}

export function createQuotaGuard(
  env: AiEnv,
  tracker: UsageTracker,
): QuotaGuard {
  return new QuotaGuard(tracker, usageLimitsFromEnv(env));
}

export function createPostgresUsageTracker(pool: Pool): UsageTracker {
  return new PostgresUsageTracker(pool);
}
