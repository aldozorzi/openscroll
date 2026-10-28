import type { FeedCard } from '@openscroll/contracts';
import { applyCursor, decodeCursor, encodeCursor } from './cursor';
import { applyDiversity, applyMmr } from './diversity';
import { RecommendationError } from './errors';
import { filterCandidates } from './filters';
import { scoreCandidates } from './scoring';
import type { FeedCandidate, FeedPage, RankFeedOptions, RankedCandidate } from './types';
import { resolveWeights } from './weights';

function toFeedCard(entry: RankedCandidate): FeedCard {
  const card = entry.candidate;
  return {
    id: card.id,
    articleId: card.articleId,
    hook: card.hook,
    coreConcept: card.coreConcept,
    keyTakeaways: [...card.keyTakeaways],
    topicTags: [...card.topicTags],
    language: card.language,
    estimatedReadTimeSec: card.estimatedReadTimeSec,
    sourceTitle: card.sourceTitle,
    sourceUrl: card.sourceUrl,
    originalUrl: card.originalUrl,
    publishedAt: card.publishedAt?.toISOString() ?? null,
    score: entry.score,
  };
}

export function rankFeed(
  candidates: readonly FeedCandidate[],
  options: RankFeedOptions,
): FeedPage {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) {
    throw new RecommendationError('limit must be an integer between 1 and 50', 'INVALID_LIMIT');
  }
  if (Number.isNaN(options.now.getTime())) {
    throw new RecommendationError('now must be a valid date', 'INVALID_NOW');
  }

  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  if (cursor && cursor.mode !== options.mode) {
    throw new RecommendationError('Cursor mode does not match the requested mode', 'INVALID_CURSOR');
  }

  const seed = cursor?.seed ?? options.seed.trim();
  if (seed.length === 0 || seed.length > 200) {
    throw new RecommendationError('seed must contain between 1 and 200 characters', 'INVALID_SEED');
  }

  const weights = resolveWeights(options.weights);
  const filtered = filterCandidates(candidates, {
    now: options.now,
    mode: options.mode,
    userVector: options.userVector,
    dismissedCardIds: options.dismissedCardIds,
    seenCardIds: options.seenCardIds,
    excludedTopics: options.excludedTopics,
    language: options.language,
    learnCooldownDays: options.learnCooldownDays,
  });

  let ranked = scoreCandidates(filtered, {
    weights,
    userVector: options.userVector,
    now: options.now,
    seed,
    halfLifeDays: options.halfLifeDays,
    dueHorizonDays: options.dueHorizonDays,
    penaltyByCardId: options.penaltyByCardId,
  });

  if (options.mmrLambda !== null && options.mmrLambda !== undefined) {
    ranked = applyMmr(ranked, options.mmrLambda);
  }

  ranked = applyDiversity(ranked, {
    maxPerSource: options.maxPerSource,
    maxPerTopic: options.maxPerTopic,
  });
  ranked = applyCursor(ranked, cursor);

  const page = ranked.slice(0, options.limit);
  const hasMore = ranked.length > page.length;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          score: last.score,
          id: last.candidate.id,
          seed,
          mode: options.mode,
        })
      : null;

  return {
    cards: page.map(toFeedCard),
    nextCursor,
    seed,
  };
}
