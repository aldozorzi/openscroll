import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb } from '@openscroll/db';
import { sources } from '@openscroll/db';
import { eq } from 'drizzle-orm';

async function reset() {
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  
  // Clear lastFetchedAt and nextFetchAt to force refetch
  const result = await db
    .update(sources)
    .set({
      lastFetchedAt: null,
      nextFetchAt: new Date(),
    })
    .where(eq(sources.isPublic, true));
  
  console.log(`Reset ${result.rowCount} sources for refetch`);
  
  await pool.end();
  process.exit(0);
}

reset().catch(console.error);
