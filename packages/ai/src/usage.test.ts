import { describe, expect, it } from 'vitest';
import { QuotaExceededError } from './errors';
import { MemoryUsageTracker, QuotaGuard, todayUtc } from './usage';

describe('QuotaGuard', () => {
  it('settles reservations against actual usage', async () => {
    const tracker = new MemoryUsageTracker();
    const guard = new QuotaGuard(tracker, {
      llmTokensPerDay: 100,
      embeddingTokensPerDay: 100,
    });

    const reservation = await guard.reserveLlm('google', 60);
    await reservation.settle(40);

    expect(await guard.getLlmUsage('google')).toBe(40);
  });

  it('releases reservations when a provider call fails', async () => {
    const tracker = new MemoryUsageTracker();
    const guard = new QuotaGuard(tracker, {
      llmTokensPerDay: 100,
      embeddingTokensPerDay: 100,
    });

    const reservation = await guard.reserveLlm('google', 50);
    await reservation.release();

    expect(await guard.getLlmUsage('google')).toBe(0);
  });

  it('fails closed when the daily limit would be exceeded', async () => {
    const tracker = new MemoryUsageTracker();
    const guard = new QuotaGuard(tracker, {
      llmTokensPerDay: 100,
      embeddingTokensPerDay: 100,
    });

    const reservation = await guard.reserveLlm('google', 80);
    await reservation.settle(80);

    await expect(guard.reserveLlm('google', 30)).rejects.toBeInstanceOf(
      QuotaExceededError,
    );
    expect(await tracker.get('google', 'llm_tokens', todayUtc())).toBe(80);
  });
});
