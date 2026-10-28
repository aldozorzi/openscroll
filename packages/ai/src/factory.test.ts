import { describe, expect, it } from 'vitest';
import { ProviderConfigError } from './errors';
import { createAiProviders, type AiEnv } from './factory';

const baseEnv: AiEnv = {
  LLM_PROVIDER: 'mock',
  LLM_MODEL: 'nvidia/nemotron-3.5-super-vl:free',
  EMBEDDING_PROVIDER: 'mock',
  EMBEDDING_MODEL: 'mock-embedding',
  EMBEDDING_DIM: 1024,
  MAX_LLM_TOKENS_PER_DAY: 200_000,
  MAX_EMBEDDING_TOKENS_PER_DAY: 1_000_000,
};

describe('createAiProviders', () => {
  it('creates an OpenRouter LLM provider', () => {
    const { llm } = createAiProviders({
      ...baseEnv,
      LLM_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_APP_NAME: 'OpenScroll',
    });

    expect(llm.name).toBe('openrouter');
    expect(llm.model).toBe('nvidia/nemotron-3.5-super-vl:free');
  });

  it('requires an OpenRouter API key', () => {
    expect(() =>
      createAiProviders({
        ...baseEnv,
        LLM_PROVIDER: 'openrouter',
      }),
    ).toThrow(ProviderConfigError);
  });
});
