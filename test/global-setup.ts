import { getSharedTestDb } from '../packages/db/src/test-db';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default async function globalSetup() {
  const handle = await getSharedTestDb();
  const envFile = join(tmpdir(), 'openscroll-test-env.json');
  writeFileSync(envFile, JSON.stringify({
    DATABASE_URL: handle.url,
    DIRECT_URL: handle.directUrl,
  }));
  console.log(`Global test database ready: ${handle.dbName}`);
}