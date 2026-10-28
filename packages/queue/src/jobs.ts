export interface IngestSourceJob {
  sourceId: string;
}

export interface ProcessArticleJob {
  articleId: string;
}

export interface GenerateCardJob {
  articleId: string;
}

export interface RetentionCleanupJob {
  requestedAt?: string;
}

export interface RecomputeUserVectorJob {
  userId: string;
}

export interface JobPayloadMap {
  'ingest-source': IngestSourceJob;
  'process-article': ProcessArticleJob;
  'generate-card': GenerateCardJob;
  'retention-cleanup': RetentionCleanupJob;
  'recompute-user-vector': RecomputeUserVectorJob;
}

export type JobName = keyof JobPayloadMap;

export const DEAD_LETTER_QUEUE = 'dead-letter';

export const QUEUE_DEFINITIONS: Readonly<
  Record<
    JobName | typeof DEAD_LETTER_QUEUE,
    {
      policy: 'standard' | 'stately';
      retryLimit: number;
      retryDelay: number;
      retryBackoff?: boolean;
      expireInSeconds: number;
      deleteAfterSeconds: number;
    }
  >
> = {
  'ingest-source': {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 900,
    deleteAfterSeconds: 86_400,
  },
  'process-article': {
    policy: 'stately',
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 900,
    deleteAfterSeconds: 604_800,
  },
  'generate-card': {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 1_800,
    deleteAfterSeconds: 604_800,
  },
  'retention-cleanup': {
    policy: 'stately',
    retryLimit: 2,
    retryDelay: 300,
    expireInSeconds: 1_800,
    deleteAfterSeconds: 604_800,
  },
  'recompute-user-vector': {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
    deleteAfterSeconds: 604_800,
  },
  [DEAD_LETTER_QUEUE]: {
    policy: 'standard',
    retryLimit: 0,
    retryDelay: 0,
    expireInSeconds: 3_600,
    deleteAfterSeconds: 2_592_000,
  },
};

export function sourceSingletonKey(sourceId: string): string {
  return `source:${sourceId}`;
}

export function articleSingletonKey(articleId: string): string {
  return `article:${articleId}`;
}

export function userSingletonKey(userId: string): string {
  return `user:${userId}`;
}
