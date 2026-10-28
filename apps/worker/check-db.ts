import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb } from '@openscroll/db';
import { articles, cards, sources } from '@openscroll/db';
import { eq, sql } from 'drizzle-orm';

async function check() {
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  
  const [arts] = await db.select({ count: sql`count(*)` }).from(articles);
  const [cds] = await db.select({ count: sql`count(*)` }).from(cards);
  const [srcs] = await db.select({ count: sql`count(*)` }).from(sources);
  
  const artStatus = await db.select({ status: articles.status, count: sql`count(*)` }).from(articles).groupBy(articles.status);
  const cardStatus = await db.select({ status: cards.status, count: sql`count(*)` }).from(cards).groupBy(cards.status);
  const srcStatus = await db.select({ isPublic: sources.isPublic, count: sql`count(*)` }).from(sources).groupBy(sources.isPublic);
  
  console.log('Articles:', arts.count);
  console.log('Cards:', cds.count);
  console.log('Sources:', srcs.count);
  console.log('Article status:', artStatus);
  console.log('Card status:', cardStatus);
  console.log('Source status:', srcStatus);
  
  await pool.end();
  process.exit(0);
}

check().catch(console.error);
