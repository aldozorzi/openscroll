import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from '@openscroll/db';
import {
  articles,
  cardReviews,
  cards,
  sources,
  userCardReviews,
  users,
} from '@openscroll/db';
import type pg from 'pg';
import { submitReview } from './review-service';

const runDatabaseTests = process.env.RUN_WORKER_DB_TESTS === '1';

describe.skipIf(!runDatabaseTests)('card review integration', () => {
  let db: Database;
  let pool: pg.Pool;
  let userId: string;
  let sourceId: string;
  let articleId: string;
  let cardId: string;

  beforeAll(async () => {
    const handle = createDb(
      process.env.DIRECT_URL ??
        'postgresql://openscroll:openscroll@localhost:5432/openscroll',
    );
    db = handle.db;
    pool = handle.pool;

    const suffix = randomUUID();
    const [user] = await db
      .insert(users)
      .values({ email: `review-${suffix}@example.com` })
      .returning({ id: users.id });
    userId = user!.id;

    const [source] = await db
      .insert(sources)
      .values({
        title: 'Review test source',
        url: `https://review.example.com/feed/${suffix}`,
        urlHash: suffix.replace(/-/g, '') + 'a'.repeat(32),
        sourceType: 'RSS',
      })
      .returning({ id: sources.id });
    sourceId = source!.id;

    const [article] = await db
      .insert(articles)
      .values({
        sourceId,
        title: 'Review test article',
        originalUrl: `https://review.example.com/${suffix}`,
        canonicalUrl: `https://review.example.com/${suffix}`,
        urlHash: suffix.replace(/-/g, '') + 'b'.repeat(32),
        status: 'ready',
      })
      .returning({ id: articles.id });
    articleId = article!.id;

    const [card] = await db
      .insert(cards)
      .values({
        articleId,
        hook: 'Review hook',
        coreConcept: 'Review concept',
        keyTakeaways: ['review'],
        estimatedReadTimeSec: 60,
        topicTags: ['review'],
        status: 'published',
      })
      .returning({ id: cards.id });
    cardId = card!.id;
  });

  afterAll(async () => {
    if (db) {
      if (sourceId) {
        await db.delete(sources).where(eq(sources.id, sourceId));
      }
      if (userId) {
        await db.delete(users).where(eq(users.id, userId));
      }
    }
    await pool?.end();
  });

  it('updates next_review and records the review idempotently', async () => {
    const now = new Date('2026-10-22T12:00:00.000Z');
    const first = await submitReview(db, {
      userId,
      cardId,
      intervalDays: 7,
      idempotencyKey: 'review-1',
      now,
    });

    expect(first.duplicate).toBe(false);
    expect(first.intervalDays).toBe(7);
    expect(first.nextReview.getTime()).toBe(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(first.state.reps).toBe(1);
    expect(first.state.due.getTime()).toBe(first.nextReview.getTime());

    const [state] = await db
      .select()
      .from(userCardReviews)
      .where(eq(userCardReviews.cardId, cardId));
    expect(state?.nextReview).toEqual(first.nextReview);
    expect(state?.lastReview).toEqual(now);

    const reviews = await db
      .select()
      .from(cardReviews)
      .where(eq(cardReviews.cardId, cardId));
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.stateBefore).toBe(0);
    expect(reviews[0]?.stateAfter).toBe(first.state.state);

    const duplicate = await submitReview(db, {
      userId,
      cardId,
      intervalDays: 7,
      idempotencyKey: 'review-1',
      now: new Date(now.getTime() + 60_000),
    });
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.reviewId).toBe(first.reviewId);
    expect(duplicate.nextReview).toEqual(first.nextReview);

    const [stateAfterDuplicate] = await db
      .select()
      .from(userCardReviews)
      .where(eq(userCardReviews.cardId, cardId));
    expect(stateAfterDuplicate?.nextReview).toEqual(first.nextReview);

    const second = await submitReview(db, {
      userId,
      cardId,
      intervalDays: 14,
      idempotencyKey: 'review-2',
      now: new Date(now.getTime() + 10 * 60_000),
    });
    expect(second.duplicate).toBe(false);
    expect(second.intervalDays).toBe(14);
    expect(second.nextReview.getTime()).toBe(new Date(now.getTime() + 10 * 60_000).getTime() + 14 * 24 * 60 * 60 * 1000);
    expect(second.state.reps).toBe(2);
    expect(second.state.due.getTime()).toBe(second.nextReview.getTime());

    const allReviews = await db
      .select({ id: cardReviews.id })
      .from(cardReviews)
      .where(eq(cardReviews.cardId, cardId));
    expect(allReviews).toHaveLength(2);
    expect(articleId).toBeTruthy();
  });
});
