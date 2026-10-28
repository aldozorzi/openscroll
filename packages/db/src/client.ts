import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { schema } from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
}

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(
  connectionString = process.env.DIRECT_URL ??
    process.env.DATABASE_URL ??
    'postgresql://openscroll:openscroll@localhost:5432/openscroll',
  max = 10,
): DatabaseHandle {
  const pool = createPool(connectionString, max);
  const db = drizzle(pool, { schema });
  return { db, pool };
}
