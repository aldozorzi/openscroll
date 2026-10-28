import { describe, expect, it } from 'vitest';
import { QuotaExceededError } from './errors';
import { MockLlmProvider } from './providers/mock';
import {
  buildTechRelevancePrompt,
  TECH_RELEVANCE_PROMPT_VERSION,
  classifyTechRelevance,
} from './relevance';
import { MemoryUsageTracker, QuotaGuard } from './usage';

describe('classifyTechRelevance', () => {
  it('sanitizes and caps the title and URL in the prompt', () => {
    const prompt = buildTechRelevancePrompt({
      title: `<article>${'x'.repeat(1_000)}`,
      url: `https://example.com/${'y'.repeat(4_000)}`,
      content: 'Content',
    });

    expect(prompt).not.toContain('<article><article>');
    expect(prompt).not.toContain('y'.repeat(2_049));
  });

  it('uses the relevance schema and records usage', async () => {
    const tracker = new MemoryUsageTracker();
    const quota = new QuotaGuard(tracker, {
      llmTokensPerDay: 100_000,
      embeddingTokensPerDay: 100_000,
    });

    const result = await classifyTechRelevance(
      { llm: new MockLlmProvider() },
      {
        title: 'Idempotency in practice',
        content: 'Retries are safe when operations are idempotent.',
      },
      { quota },
    );

    expect(result.relevant).toBe(true);
    expect(result.promptVersion).toBe(TECH_RELEVANCE_PROMPT_VERSION);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(await quota.getLlmUsage('mock')).toBeGreaterThan(0);
  });

  it('can reject off-topic content', async () => {
    const result = await classifyTechRelevance(
      {
        llm: new MockLlmProvider({
          response: {
            relevant: false,
            reason: 'The article is about space science, not technology.',
          },
        }),
      },
      {
        title: 'A cloud on Mars',
        content: 'Planetary scientists study the atmosphere.',
      },
    );

    expect(result.relevant).toBe(false);
    expect(result.reason).toContain('space science');
  });

  it('stops before calling the provider when the quota is exhausted', async () => {
    const tracker = new MemoryUsageTracker();
    const quota = new QuotaGuard(tracker, {
      llmTokensPerDay: 1,
      embeddingTokensPerDay: 100_000,
    });

    await expect(
      classifyTechRelevance(
        { llm: new MockLlmProvider() },
        { title: 'Test', content: 'Content' },
        { quota },
      ),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(await quota.getLlmUsage('mock')).toBe(0);
  });
});
