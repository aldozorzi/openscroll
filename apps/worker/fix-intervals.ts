import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb } from '@openscroll/db';
import { sources } from '@openscroll/db';
import { eq } from 'drizzle-orm';

async function fix() {
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  
  // Set default interval (360min = 6h) and nextFetchAt = now for all public sources
  const result = await db
    .update(sources)
    .set({
      intervalMinutes: 360,
      nextFetchAt: new Date(),
    })
    .where(eq(sources.isPublic, true));
  
  console.log(`Updated ${result.rowCount} sources with default interval and immediate nextFetch`);
  
  await pool.end();
  process.exit(0);
}

fix().catch(console.error);
