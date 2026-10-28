import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { instrumentProviders } from './observability';
import { MockEmbeddingProvider, MockLlmProvider } from './providers/mock';

describe('provider instrumentation', () => {
  it('records latency, usage, and outcomes without prompt content', async () => {
    const observations: unknown[] = [];
    const providers = instrumentProviders(
      {
        llm: new MockLlmProvider({ response: { ok: true } }),
        embedding: new MockEmbeddingProvider({ dimensions: 8 }),
      },
      (observation) => observations.push(observation),
    );

    await providers.llm.generateObject({
      system: 'system',
      prompt: 'private article text',
      schema: z.object({ ok: z.boolean() }),
    });
    await providers.embedding.embed(['private article text']);

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      event: 'provider_call',
      operation: 'llm.generate',
      outcome: 'success',
    });
    expect(observations[1]).toMatchObject({
      event: 'provider_call',
      operation: 'embedding.create',
      outcome: 'success',
      embeddingCount: 1,
      dimensions: 8,
    });
    expect(JSON.stringify(observations)).not.toContain('private article text');
  });

  it('records failed calls and rethrows', async () => {
    const observations: unknown[] = [];
    const providers = instrumentProviders(
      {
        llm: {
          name: 'broken',
          model: 'broken-model',
          async generateObject() {
            throw new TypeError('provider failed');
          },
        },
        embedding: new MockEmbeddingProvider({ dimensions: 8 }),
      },
      (observation) => observations.push(observation),
    );

    await expect(
      providers.llm.generateObject({
        system: 'system',
        prompt: 'prompt',
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toThrow('provider failed');
    expect(observations[0]).toMatchObject({
      outcome: 'error',
      errorName: 'TypeError',
    });
  });
});
