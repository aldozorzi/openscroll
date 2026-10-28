import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb } from '@openscroll/db';
import { sources } from '@openscroll/db';

async function check() {
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  
  const results = await db.select().from(sources).limit(20);
  
  console.log('Sources (first 20):');
  results.forEach(s => console.log(
    `  ${s.category} | ${s.title} | public=${s.isPublic} | interval=${s.intervalMinutes}m | lastFetched=${s.lastFetchedAt} | nextFetch=${s.nextFetchAt} | fails=${s.fails}`
  ));
  
  await pool.end();
  process.exit(0);
}

check().catch(console.error);
