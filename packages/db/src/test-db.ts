import 'dotenv/config';
import pg from 'pg';
import { resolveDatabaseUrl, runMigrations } from './migrate';

const TEST_DB_PREFIX = 'openscroll_test_';
const DEFAULT_TEMPLATE_DB = 'openscroll_test_template';
const TEMPLATE_LOCK_KEY = 8312374650123456;

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function createAdminPool(): pg.Pool {
  return new pg.Pool({
    connectionString: withDatabase(resolveDatabaseUrl(), 'postgres'),
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
}

/**
 * The test database is built from a template that always reflects the current
 * SQL migrations, so tests do not depend on the state of the development
 * database. Without this, CI (where the base database starts empty) and any
 * local checkout with a stale template would run DB tests against a schema
 * that is missing tables.
 */
async function getTemplateDb(): Promise<string> {
  const templateDb = process.env.TEST_TEMPLATE_DB || DEFAULT_TEMPLATE_DB;
  const adminPool = createAdminPool();
  const lock = await adminPool.connect();

  try {
    // Serialise template creation/migration across concurrent test runs.
    await lock.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK_KEY]);

    const exists = await lock.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      templateDb,
    ]);
    if (exists.rowCount === 0) {
      console.log(`Creating test template database ${templateDb}...`);
      try {
        await lock.query(
          `CREATE DATABASE ${quoteIdent(templateDb)} TEMPLATE template0`,
        );
      } catch (error) {
        // Another process created it between the check and the CREATE.
        if ((error as { code?: string }).code !== '42P04') throw error;
      }
    }

    console.log(`Applying migrations to test template ${templateDb}...`);
    await runMigrations(withDatabase(resolveDatabaseUrl(), templateDb));

    return templateDb;
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK_KEY]);
    lock.release();
    await adminPool.end();
  }
}

/**
 * The test database is built from a fresh template, so the development
 * database's pending/failed pg-boss jobs are not copied. Purging is kept as a
 * defensive measure for templates supplied via `TEST_TEMPLATE_DB`.
 */
async function purgeQueueState(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'pgboss'`,
  );
  const jobTables = rows
    .map((row) => row.table_name)
    .filter((name) => name === 'job' || name === 'job_common')
    .map((name) => `pgboss."${name}"`);
  if (jobTables.length > 0) {
    await pool.query(`TRUNCATE TABLE ${jobTables.join(', ')} CASCADE`);
  }
}

interface TestDatabaseHandle {
  dbName: string;
  url: string;
  directUrl: string;
  pool: pg.Pool;
  db: any;
}

let sharedTestDb: TestDatabaseHandle | null = null;

export async function getSharedTestDb(): Promise<TestDatabaseHandle> {
  if (sharedTestDb) return sharedTestDb;

  const existingUrl =
    process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? null;
  if (
    process.env.OPENSCROLL_USE_TEST_DB === 'true' &&
    existingUrl &&
    new URL(existingUrl).pathname.slice(1).startsWith(TEST_DB_PREFIX)
  ) {
    const dbName = new URL(existingUrl).pathname.slice(1);
    const pool = new pg.Pool({
      connectionString: existingUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const db = drizzle(pool, { schema: await import('../src/schema') });
    sharedTestDb = {
      dbName,
      url: existingUrl,
      directUrl: existingUrl,
      pool,
      db,
    };
    console.log(`Reusing test database: ${dbName}`);
    return sharedTestDb;
  }

  const adminPool = createAdminPool();
  const testDbName = `openscroll_test_shared_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const templateDb = await getTemplateDb();
    // CREATE DATABASE ... TEMPLATE fails if another session is connected to
    // the template; a previous run may have left a connection open.
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [templateDb],
    );
    await adminPool.query(
      `CREATE DATABASE ${quoteIdent(testDbName)} TEMPLATE ${quoteIdent(templateDb)}`,
    );
    console.log(`Created shared test database: ${testDbName}`);
  } finally {
    await adminPool.end();
  }

  const url = withDatabase(resolveDatabaseUrl(), testDbName);
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  await purgeQueueState(pool);

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { schema } = await import('../src/schema');
  const db = drizzle(pool, { schema: await import('../src/schema') });

  sharedTestDb = { dbName: testDbName, url, directUrl: url, pool, db };
  return sharedTestDb;
}

export async function destroySharedTestDb(): Promise<void> {
  if (sharedTestDb) {
    await sharedTestDb.pool.end();
    const adminPool = createAdminPool();
    try {
      await adminPool.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [sharedTestDb.dbName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdent(sharedTestDb.dbName)}`);
      console.log(`Dropped shared test database: ${sharedTestDb.dbName}`);
    } finally {
      await adminPool.end();
    }
    sharedTestDb = null;
  }
}

export async function truncateAllTables(db: any): Promise<void> {
  await db.execute(`
    TRUNCATE TABLE
      card_reviews,
      user_card_reviews,
      user_interactions,
      cards,
      articles,
      user_sources,
      sources,
      email_verification_sends,
      email_verification_tokens,
      password_reset_tokens,
      user_preferences,
      users,
      provider_usage,
      audit_log
    RESTART IDENTITY CASCADE;
  `);
}
