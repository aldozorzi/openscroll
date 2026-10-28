import { describe, expect, it } from 'vitest';
import { QuotaExceededError } from './errors';
import { generateMicroCard } from './generate-card';
import { MockEmbeddingProvider, MockLlmProvider } from './providers/mock';
import { MemoryUsageTracker, QuotaGuard } from './usage';

function dependencies() {
  return {
    llm: new MockLlmProvider(),
    embedding: new MockEmbeddingProvider(),
  };
}

describe('generateMicroCard', () => {
  it('validates the card, computes read time, and stores a unit embedding', async () => {
    const card = await generateMicroCard(dependencies(), {
      title: 'Idempotency',
      content: 'Retries are safe when operations are idempotent.',
      language: 'en',
      url: 'https://example.com/idempotency',
    });

    expect(card.hook.length).toBeGreaterThanOrEqual(10);
    expect(card.estimatedReadTimeSec).toBeGreaterThan(0);
    expect(card.embedding).toHaveLength(1024);
    expect(card.embeddingDim).toBe(1024);
    expect(card.embeddingModel).toBe('mock-embedding');
    expect(card.generationModel).toBe('mock-llm');
    expect(card.promptVersion).toBe('micro-card-v2');

    const norm = Math.sqrt(
      card.embedding.reduce((sum, value) => sum + value * value, 0),
    );
    expect(norm).toBeCloseTo(1, 5);
  });

  it('tracks llm and embedding usage', async () => {
    const tracker = new MemoryUsageTracker();
    const quota = new QuotaGuard(tracker, {
      llmTokensPerDay: 100_000,
      embeddingTokensPerDay: 100_000,
    });

    await generateMicroCard(
      dependencies(),
      { title: 'Usage', content: 'Some article content.' },
      { quota },
    );

    expect(await quota.getLlmUsage('mock')).toBeGreaterThan(0);
    expect(await quota.getEmbeddingUsage('mock')).toBeGreaterThan(0);
  });

  it('stops before calling providers when the quota is exhausted', async () => {
    const tracker = new MemoryUsageTracker();
    const quota = new QuotaGuard(tracker, {
      llmTokensPerDay: 1,
      embeddingTokensPerDay: 100_000,
    });

    await expect(
      generateMicroCard(
        dependencies(),
        { title: 'Quota', content: 'Some article content.' },
        { quota },
      ),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await quota.getLlmUsage('mock')).toBe(0);
  });
});
