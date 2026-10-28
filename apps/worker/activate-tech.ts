import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb } from '@openscroll/db';
import { sources } from '@openscroll/db';
import { eq, and, inArray } from 'drizzle-orm';

async function activate() {
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  
  const techCategories = [
    'technology', 'Tech', 'programming', 'Programming', 'iOS Development',
    'Web Development', 'UI / UX'
  ];
  
  const result = await db
    .update(sources)
    .set({ isPublic: true })
    .where(
      and(
        eq(sources.isPublic, false),
        inArray(sources.category, techCategories)
      )
    )
    .returning({ id: sources.id, title: sources.title, category: sources.category });
  
  console.log(`Activated ${result.length} sources:`);
  result.forEach(s => console.log(`  - ${s.category}: ${s.title}`));
  
  await pool.end();
  process.exit(0);
}

activate().catch(console.error);
