import { seedContent } from './db';
import { getSharedTestDb, truncateAllTables } from '../../../packages/db/src/test-db';

export default async function globalSetup(): Promise<void> {
  console.log('E2E global setup: truncating and seeding test database...');
  const handle = await getSharedTestDb();
  console.log('Truncating tables...');
  await truncateAllTables(handle.db);
  
  // Verify truncate
  const { rows: cardCount } = await handle.pool.query('SELECT count(*)::int as c FROM cards');
  const { rows: articleCount } = await handle.pool.query('SELECT count(*)::int as c FROM articles');
  console.log(`After truncate: cards=${cardCount[0].c}, articles=${articleCount[0].c}`);
  
  console.log('Seeding content...');
  await seedContent();
  
  // Verify seed
  const { rows: cardCount2 } = await handle.pool.query('SELECT count(*)::int as c FROM cards');
  const { rows: articleCount2 } = await handle.pool.query('SELECT count(*)::int as c FROM articles');
  console.log(`After seed: cards=${cardCount2[0].c}, articles=${articleCount2[0].c}`);
  
  console.log('E2E global setup: done');
}
