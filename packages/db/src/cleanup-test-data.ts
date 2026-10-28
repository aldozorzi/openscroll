import 'dotenv/config';
import { createDb } from './client';
import { and, eq, ilike, isNotNull } from 'drizzle-orm';
import { articles, cards, sources, users } from './schema';

async function main(): Promise<void> {
  const { db, pool } = createDb();

  try {
    // 1. Delete mock cards (hook contains "Why does idempotency make retries safe?")
    console.log('Deleting mock cards...');
    const mockCards = await db
      .select({ id: cards.id, articleId: cards.articleId })
      .from(cards)
      .where(ilike(cards.hook, '%Why does idempotency make retries safe?%'));
    console.log(`Found ${mockCards.length} mock cards`);

    if (mockCards.length > 0) {
      const mockCardIds = mockCards.map((c) => c.id);
      const mockArticleIds = mockCards.map((c) => c.articleId);

      // Delete cards (cascades to interactions, reviews)
      await db.delete(cards).where(ilike(cards.hook, '%Why does idempotency make retries safe?%'));
      console.log('Deleted mock cards');

      // Delete their articles if no other cards reference them
      for (const articleId of mockArticleIds) {
        const remainingCards = await db
          .select({ id: cards.id })
          .from(cards)
          .where(eq(cards.articleId, articleId))
          .limit(1);
        if (remainingCards.length === 0) {
          await db.delete(articles).where(eq(articles.id, articleId));
        }
      }
      console.log('Deleted orphan mock articles');
    }

    // 2. Delete E2E and probe test users (keep test@example.com and aldo.zorzi@gmail.com)
    console.log('Deleting test users...');
    const testUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        and(
          ilike(users.email, 'e2e-%@example.com'),
          // also probe-* users
        ),
      );
    // Also probe users
    const probeUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(ilike(users.email, 'probe-%@example.com'));

    const allTestUsers = [...testUsers, ...probeUsers];
    console.log(`Found ${allTestUsers.length} test users to delete`);

    for (const user of allTestUsers) {
      // Deleting user will cascade to sessions, preferences, interactions, reviews, subscriptions, owned sources
      await db.delete(users).where(eq(users.id, user.id));
      console.log(`Deleted user ${user.email}`);
    }

    // 3. Optionally delete E2E sources (if any) - but we'll skip to avoid deleting real sources.

    console.log('Cleanup completed.');
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();