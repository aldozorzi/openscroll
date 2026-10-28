import 'dotenv/config';
import { getSharedTestDb, destroySharedTestDb } from '../packages/db/src/test-db';

async function main() {
  console.log('Setting up test database...');
  const handle = await getSharedTestDb();
  console.log(`Test database ready: ${handle.dbName}`);

  process.env.DATABASE_URL = handle.url;
  process.env.DIRECT_URL = handle.directUrl;
  process.env.OPENSCROLL_USE_TEST_DB = 'true';

  // Run tests
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('corepack', ['pnpm', '-r', 'test'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: handle.url,
      DIRECT_URL: handle.directUrl,
      OPENSCROLL_USE_TEST_DB: 'true',
    },
  });

  console.log('Cleaning up test database...');
  await destroySharedTestDb();

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});