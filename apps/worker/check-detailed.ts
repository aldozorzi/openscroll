import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb } from '@openscroll/db';
import { sources, articles } from '@openscroll/db';
import { eq, sql } from 'drizzle-orm';

async function check() {
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  
  const sourcesData = await db.select().from(sources).where(eq(sources.isPublic, true)).limit(10);
  
  console.log('Sources (first 10):');
  sourcesData.forEach(s => console.log(
    `  ${s.title} | lastFetched=${s.lastFetchedAt} | nextFetch=${s.nextFetchAt} | fails=${s.fails}`
  ));
  
  const [artCount] = await db.select({ count: sql`count(*)` }).from(articles);
  console.log(`\nTotal articles: ${artCount.count}`);
  
  await pool.end();
  process.exit(0);
}

check().catch(console.error);
