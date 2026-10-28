export class AiError extends Error {
  readonly code: string;

  constructor(message: string, code = 'AI_ERROR', options?: ErrorOptions) {
    super(message, options);
    this.name = 'AiError';
    this.code = code;
  }
}

export class ProviderConfigError extends AiError {
  constructor(message: string) {
    super(message, 'PROVIDER_CONFIG');
    this.name = 'ProviderConfigError';
  }
}

export class ProviderHttpError extends AiError {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    status: number,
    options?: {
      retryable?: boolean;
      retryAfterMs?: number | null;
      cause?: unknown;
    },
  ) {
    super(message, 'PROVIDER_HTTP', { cause: options?.cause });
    this.name = 'ProviderHttpError';
    this.status = status;
    this.retryable = options?.retryable ?? (status === 429 || status >= 500);
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}

export class ProviderRateLimitError extends ProviderHttpError {
  constructor(message: string, retryAfterMs: number | null) {
    super(message, 429, { retryable: true, retryAfterMs });
    this.name = 'ProviderRateLimitError';
  }
}

export class ProviderResponseError extends AiError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, 'PROVIDER_RESPONSE', options);
    this.name = 'ProviderResponseError';
  }
}

export class QuotaExceededError extends AiError {
  readonly provider: string;
  readonly metric: string;
  readonly limit: number;

  constructor(provider: string, metric: string, limit: number) {
    super(
      `Daily quota exceeded for ${provider} ${metric} (limit ${limit})`,
      'QUOTA_EXCEEDED',
    );
    this.name = 'QuotaExceededError';
    this.provider = provider;
    this.metric = metric;
    this.limit = limit;
  }
}
