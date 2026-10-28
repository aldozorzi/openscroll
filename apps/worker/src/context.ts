import type { Pool } from 'pg';
import {
  createAiProviders,
  createPostgresUsageTracker,
  createQuotaGuard,
  instrumentProviders,
  type EmbeddingProvider,
  type LlmProvider,
  type QuotaGuard,
} from '@openscroll/ai';
import {
  getDirectDatabaseUrl,
  getServerEnv,
  type ServerEnv,
} from '@openscroll/config';
import { createDb, type Database } from '@openscroll/db';
import {
  fetchFeed,
  safeFetch,
  type FetchFeedOptions,
  type FetchFeedResult,
  type SafeFetchOptions,
  type SafeFetchResponse,
} from '@openscroll/ingest';
import {
  createQueueAdapter,
  queueOptionsFromEnv,
  type QueueAdapter,
} from '@openscroll/queue';
import { createLogger, type Logger } from './logger';

const ARTICLE_FETCH_HEADERS: Record<string, string> = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br, zstd',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

export type FetchFeed = (
  url: string,
  options?: FetchFeedOptions,
) => Promise<FetchFeedResult>;

export type FetchArticle = (
  url: string,
  options?: SafeFetchOptions,
) => Promise<SafeFetchResponse>;

export interface WorkerContext {
  env: ServerEnv;
  db: Database;
  pool: Pool;
  queue: QueueAdapter;
  llm: LlmProvider;
  embedding: EmbeddingProvider;
  quota: QuotaGuard;
  now: () => Date;
  fetchFeed: FetchFeed;
  fetchArticle: FetchArticle;
  logger: Logger;
}

export interface CreateWorkerContextOptions {
  env?: ServerEnv;
  now?: () => Date;
  logger?: Logger;
  fetchFeed?: FetchFeed;
  fetchArticle?: FetchArticle;
}

export function createWorkerContext(
  options: CreateWorkerContextOptions = {},
): WorkerContext {
  const env = options.env ?? getServerEnv();
  const databaseUrl = getDirectDatabaseUrl(env);
  const { db, pool } = createDb(databaseUrl);
  const queue = createQueueAdapter(
    queueOptionsFromEnv(env, 'openscroll-worker'),
  );
  const logger = options.logger ?? createLogger();
  const providers = instrumentProviders(createAiProviders(env), (observation) => {
    logger.info(observation.event, { ...observation });
  });
  const quota = createQuotaGuard(env, createPostgresUsageTracker(pool));

  const fetchArticle = async (
    url: string,
    options?: SafeFetchOptions,
  ): Promise<SafeFetchResponse> => {
    let referer: string;
    try {
      const u = new URL(url);
      referer = `${u.protocol}//${u.hostname}/`;
    } catch {
      referer = 'https://www.google.com/';
    }
    return safeFetch(url, {
      ...options,
      headers: {
        ...ARTICLE_FETCH_HEADERS,
        referer,
        ...options?.headers,
      },
    });
  };

  return {
    env,
    db,
    pool,
    queue,
    llm: providers.llm,
    embedding: providers.embedding,
    quota,
    now: options.now ?? (() => new Date()),
    fetchFeed: options.fetchFeed ?? fetchFeed,
    fetchArticle: options.fetchArticle ?? fetchArticle,
    logger,
  };
}
