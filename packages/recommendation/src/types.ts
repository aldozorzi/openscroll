import type { FeedCard, FeedMode } from '@openscroll/contracts';

export interface FeedCandidateReview {
  nextReview: Date;
  lastReview: Date | null;
  state: number;
}

export interface FeedCandidate {
  id: string;
  articleId: string;
  hook: string;
  coreConcept: string;
  keyTakeaways: string[];
  topicTags: string[];
  language: string | null;
  estimatedReadTimeSec: number;
  sourceId: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  originalUrl: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  embedding: number[] | null;
  status: string;
  review: FeedCandidateReview | null;
  penalty?: number;
}

export interface RankingWeights {
  semantic: number;
  fsrs: number;
  fresh: number;
  explore: number;
}

export interface RankFeedOptions {
  now: Date;
  mode: FeedMode;
  limit: number;
  seed: string;
  userVector: number[] | null;
  cursor?: string | null;
  weights?: Partial<RankingWeights>;
  halfLifeDays?: number;
  dueHorizonDays?: number;
  learnCooldownDays?: number;
  dismissedCardIds?: ReadonlySet<string>;
  seenCardIds?: ReadonlySet<string>;
  excludedTopics?: readonly string[];
  language?: string | null;
  maxPerSource?: number;
  maxPerTopic?: number;
  penaltyByCardId?: ReadonlyMap<string, number>;
  mmrLambda?: number | null;
}

export interface RankedCandidate {
  candidate: FeedCandidate;
  score: number;
}

export interface FeedPage {
  cards: FeedCard[];
  nextCursor: string | null;
  seed: string;
}
