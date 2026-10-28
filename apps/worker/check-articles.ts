import { getDirectDatabaseUrl, getServerEnv } from '@openscroll/config';
import { createDb } from '@openscroll/db';
import { articles } from '@openscroll/db';
import { eq, sql } from 'drizzle-orm';

async function check() {
  const { db, pool } = createDb(getDirectDatabaseUrl(getServerEnv()));
  
  const results = await db.select({
    id: articles.id,
    status: articles.status,
    title: articles.title,
    createdAt: articles.createdAt
  }).from(articles).limit(30);
  
  console.log('Articles (first 30):');
  results.forEach(a => console.log(`  ${a.status} | ${a.title?.substring(0,60)}`));
  
  process.exit(0);
}

check().catch(console.error);
