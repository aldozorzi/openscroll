import type { Pool } from 'pg';
import { QuotaExceededError } from './errors';

export interface UsageTracker {
  get(provider: string, metric: string, date: string): Promise<number>;
  add(
    provider: string,
    metric: string,
    delta: number,
    date: string,
  ): Promise<number>;
  addIfWithin(
    provider: string,
    metric: string,
    amount: number,
    limit: number,
    date: string,
  ): Promise<boolean>;
}

export interface UsageLimits {
  llmTokensPerDay: number;
  embeddingTokensPerDay: number;
}

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function usageKey(provider: string, metric: string, date: string): string {
  return `${provider}:${metric}:${date}`;
}

export class MemoryUsageTracker implements UsageTracker {
  private readonly values = new Map<string, number>();

  async get(provider: string, metric: string, date: string): Promise<number> {
    return this.values.get(usageKey(provider, metric, date)) ?? 0;
  }

  async add(
    provider: string,
    metric: string,
    delta: number,
    date: string,
  ): Promise<number> {
    const key = usageKey(provider, metric, date);
    const next = Math.max(0, (this.values.get(key) ?? 0) + delta);
    this.values.set(key, next);
    return next;
  }

  async addIfWithin(
    provider: string,
    metric: string,
    amount: number,
    limit: number,
    date: string,
  ): Promise<boolean> {
    const current = await this.get(provider, metric, date);
    if (current + amount > limit) {
      return false;
    }
    await this.add(provider, metric, amount, date);
    return true;
  }
}

export class PostgresUsageTracker implements UsageTracker {
  constructor(private readonly pool: Pool) {}

  async get(provider: string, metric: string, date: string): Promise<number> {
    const result = await this.pool.query<{ value: string }>(
      `SELECT value
         FROM provider_usage
        WHERE provider = $1 AND metric = $2 AND usage_date = $3::date`,
      [provider, metric, date],
    );
    return Number(result.rows[0]?.value ?? 0);
  }

  async add(
    provider: string,
    metric: string,
    delta: number,
    date: string,
  ): Promise<number> {
    const result = await this.pool.query<{ value: string }>(
      `INSERT INTO provider_usage (provider, metric, usage_date, value)
       VALUES ($1, $2, $3::date, GREATEST(0, $4::bigint))
       ON CONFLICT (provider, metric, usage_date)
       DO UPDATE SET value = GREATEST(0, provider_usage.value + $4::bigint),
                     updated_at = now()
       RETURNING value`,
      [provider, metric, date, delta],
    );
    return Number(result.rows[0]?.value ?? 0);
  }

  async addIfWithin(
    provider: string,
    metric: string,
    amount: number,
    limit: number,
    date: string,
  ): Promise<boolean> {
    const result = await this.pool.query<{ value: string }>(
      `INSERT INTO provider_usage (provider, metric, usage_date, value)
       SELECT $1, $2, $3::date, $4::bigint
        WHERE $4::bigint <= $5::bigint
       ON CONFLICT (provider, metric, usage_date)
       DO UPDATE SET value = provider_usage.value + EXCLUDED.value,
                     updated_at = now()
        WHERE provider_usage.value + EXCLUDED.value <= $5::bigint
       RETURNING value`,
      [provider, metric, date, amount, limit],
    );
    return result.rowCount === 1;
  }
}

export interface UsageReservation {
  settle(actualAmount: number): Promise<void>;
  release(): Promise<void>;
}

class Reservation implements UsageReservation {
  private settled = false;

  constructor(
    private readonly tracker: UsageTracker,
    private readonly provider: string,
    private readonly metric: string,
    private readonly reserved: number,
    private readonly date: string,
  ) {}

  async settle(actualAmount: number): Promise<void> {
    if (this.settled) {
      return;
    }
    this.settled = true;
    const delta = Math.max(0, actualAmount) - this.reserved;
    if (delta !== 0) {
      await this.tracker.add(this.provider, this.metric, delta, this.date);
    }
  }

  async release(): Promise<void> {
    if (this.settled) {
      return;
    }
    this.settled = true;
    await this.tracker.add(
      this.provider,
      this.metric,
      -this.reserved,
      this.date,
    );
  }
}

export class QuotaGuard {
  constructor(
    private readonly tracker: UsageTracker,
    private readonly limits: UsageLimits,
  ) {}

  async reserveLlm(
    provider: string,
    estimatedTokens: number,
    date = todayUtc(),
  ): Promise<UsageReservation> {
    return this.reserve(
      provider,
      'llm_tokens',
      estimatedTokens,
      this.limits.llmTokensPerDay,
      date,
    );
  }

  async reserveEmbedding(
    provider: string,
    estimatedTokens: number,
    date = todayUtc(),
  ): Promise<UsageReservation> {
    return this.reserve(
      provider,
      'embedding_tokens',
      estimatedTokens,
      this.limits.embeddingTokensPerDay,
      date,
    );
  }

  async getLlmUsage(provider: string, date = todayUtc()): Promise<number> {
    return this.tracker.get(provider, 'llm_tokens', date);
  }

  async getEmbeddingUsage(provider: string, date = todayUtc()): Promise<number> {
    return this.tracker.get(provider, 'embedding_tokens', date);
  }

  private async reserve(
    provider: string,
    metric: string,
    estimatedTokens: number,
    limit: number,
    date: string,
  ): Promise<UsageReservation> {
    const amount = Math.max(1, Math.ceil(estimatedTokens));
    const allowed = await this.tracker.addIfWithin(
      provider,
      metric,
      amount,
      limit,
      date,
    );
    if (!allowed) {
      throw new QuotaExceededError(provider, metric, limit);
    }
    return new Reservation(this.tracker, provider, metric, amount, date);
  }
}
