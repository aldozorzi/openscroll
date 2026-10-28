import type { Pool } from 'pg';
import { getServerEnv } from '@openscroll/config';
import { createDb, type Database } from '@openscroll/db';

interface DbHandle {
  db: Database;
  pool: Pool;
}

const globalForDb = globalThis as typeof globalThis & {
  __openscrollDb?: DbHandle;
};

export function getDb(): Database {
  if (!globalForDb.__openscrollDb) {
    globalForDb.__openscrollDb = createDb(getServerEnv().DATABASE_URL, 5);
  }
  return globalForDb.__openscrollDb.db;
}

export function getPool(): Pool {
  if (!globalForDb.__openscrollDb) {
    globalForDb.__openscrollDb = createDb(getServerEnv().DATABASE_URL, 5);
  }
  return globalForDb.__openscrollDb.pool;
}

export async function closeDbForTests(): Promise<void> {
  const handle = globalForDb.__openscrollDb;
  if (!handle) {
    return;
  }
  globalForDb.__openscrollDb = undefined;
  await handle.pool.end();
}
