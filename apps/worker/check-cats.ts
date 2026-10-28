import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb } from '@openscroll/db';
import { sources } from '@openscroll/db';
import { eq, sql } from 'drizzle-orm';

async function check() {
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  
  const cats = await db.select({ category: sources.category, isPublic: sources.isPublic, count: sources.isPublic })
    .from(sources)
    .groupBy(sources.category, sources.isPublic);
  
  console.log('Categories by status:');
  cats.forEach(c => console.log(`  ${c.category} | public=${c.isPublic}: ${c.count}`));
  
  process.exit(0);
}

check().catch(console.error);
