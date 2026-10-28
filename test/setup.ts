import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getSharedTestDb, destroySharedTestDb, truncateAllTables } from '../packages/db/src/test-db';
import { createWorkerContext } from '../apps/worker/src/context';

let testDbHandle: any;

export async function setupTestDatabase() {
  const handle = await import('../packages/db/src/test-db').then(m => m.getSharedTestDb());
  process.env.DATABASE_URL = handle.url;
  process.env.DIRECT_URL = handle.directUrl;
  console.log(`Test database ready: ${handle.dbName}`);
  return handle;
}

export async function teardownTestDatabase() {
  await import('../packages/db/src/test-db').then(m => m.destroySharedTestDb());
}

export function createTestWorkerContext(overrides = {}) {
  return import('../apps/worker/src/context').then(m => m.createWorkerContext(overrides));
}

export function truncateTestDb(db: any) {
  return import('../packages/db/src/test-db').then(m => m.truncateAllTables(db));
}