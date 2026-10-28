import 'dotenv/config';
import { createDb } from './client';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { articles, cards, userInteractions, userCardReviews, cardReviews, users, userSources, sources } from './schema';

async function main(): Promise<void> {
  const { db, pool } = createDb();

  try {
    console.log('=== CLEANING MOCK/TEST DATA ===');

    // 1. Find all mock cards (gemini-2.5-flash-lite model)
    const mockCards = await db
      .select({ id: cards.id, articleId: cards.articleId })
      .from(cards)
      .where(eq(cards.generationModel, 'gemini-2.5-flash-lite'));
    console.log(`Found ${mockCards.length} mock cards (gemini-2.5-flash-lite)`);

    if (mockCards.length > 0) {
      const mockCardIds = mockCards.map(c => c.id);
      const mockArticleIds = [...new Set(mockCards.map(c => c.articleId).filter(Boolean))];

      // Delete cards (cascades to user_interactions, user_card_reviews, card_reviews)
      await db.delete(cards).where(ilike(cards.generationModel, 'gemini-2.5-flash-lite%'));
      console.log('Deleted mock cards');

      // Delete orphan articles (no other cards reference them)
      for (const articleId of mockArticleIds) {
        const remaining = await db.select({ id: cards.id }).from(cards).where(eq(cards.articleId, articleId)).limit(1);
        if (remaining.length === 0) {
          await db.delete(articles).where(eq(articles.id, articleId));
        }
      }
      console.log('Deleted orphan mock articles');
    }

    // 2. Delete E2E/test users (keep aldo.zorzi@gmail.com and test@example.com)
    const testUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        or(
          ilike(users.email, 'e2e-%@example.com'),
          ilike(users.email, 'probe-%@example.com'),
        ),
      );
    console.log(`Found ${testUsers.length} test users to delete`);

    for (const user of testUsers) {
      await db.delete(users).where(eq(users.id, user.id));
      console.log(`Deleted test user: ${user.email}`);
    }

    // 3. Delete E2E sources (e2e.openscroll.local)
    const e2eSources = await db
      .select({ id: sources.id, title: sources.title })
      .from(sources)
      .where(or(
        ilike(sources.url, '%e2e.openscroll.local%'),
        ilike(sources.url, '%e2e.example.com%'),
      ));
    if (e2eSources.length > 0) {
      for (const src of e2eSources) {
        await db.delete(sources).where(eq(sources.id, src.id));
        console.log(`Deleted E2E source: ${src.title}`);
      }
    }

    // 4. Verify cleanup
    const cardCountResult = await db.select({ count: sql<number>`count(*)::int` }).from(cards);
    const articleCountResult = await db.select({ count: sql<number>`count(*)::int` }).from(articles);
    const userCountResult = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const realCardsResult = await db.select({ count: sql<number>`count(*)::int` })
      .from(cards)
      .where(eq(cards.generationModel, 'nvidia/nemotron-3-ultra-550b-a55b:free'));
    const remainingUsers = await db.select({ email: users.email }).from(users);

    const cardCount = cardCountResult[0]?.count ?? 0;
    const articleCount = articleCountResult[0]?.count ?? 0;
    const userCount = userCountResult[0]?.count ?? 0;
    const realCards = realCardsResult[0]?.count ?? 0;

    console.log('\n=== AFTER CLEANUP ===');
    console.log(`Cards: ${cardCount} (real Nemotron: ${realCards})`);
    console.log(`Articles: ${articleCount}`);
    console.log(`Users: ${userCount}`);
    console.log('Remaining users:', remainingUsers.map((u: { email: string }) => u.email).join(', '));

  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();